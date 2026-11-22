import type { Redis, Result } from 'ioredis';
import { normalizeHotelName } from '../domain/selectBestOffers';
import type { HotelOffer, PriceRange } from '../types';

/**
 * Per city we keep two keys:
 *   hotels:{city}:prices  ZSET  member = normalized hotel name, score = best price
 *   hotels:{city}:offers  HASH  field  = normalized hotel name, value = HotelOffer JSON
 *
 * Price filtering happens inside Redis: ZRANGEBYSCORE picks the names in range
 * (already sorted by price) and HMGET fetches their offers, in one atomic Lua call.
 */
const FILTER_BY_PRICE_LUA = `
local names = redis.call('ZRANGEBYSCORE', KEYS[1], ARGV[1], ARGV[2])
if #names == 0 then
  return {}
end
return redis.call('HMGET', KEYS[2], unpack(names))
`;

declare module 'ioredis' {
  interface RedisCommander<Context> {
    filterHotelsByPrice(
      pricesKey: string,
      offersKey: string,
      min: string,
      max: string,
    ): Result<(string | null)[], Context>;
  }
}

export function hotelKeys(city: string) {
  const c = city.trim().toLowerCase();
  return { prices: `hotels:${c}:prices`, offers: `hotels:${c}:offers` };
}

export class HotelStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {
    redis.defineCommand('filterHotelsByPrice', { numberOfKeys: 2, lua: FILTER_BY_PRICE_LUA });
  }

  /** Atomically replaces the stored list for a city. */
  async save(city: string, hotels: HotelOffer[]): Promise<void> {
    const keys = hotelKeys(city);
    const tx = this.redis.multi().del(keys.prices, keys.offers);

    if (hotels.length > 0) {
      const scoreMembers = hotels.flatMap((h) => [h.price, normalizeHotelName(h.name)]);
      const offers = Object.fromEntries(hotels.map((h) => [normalizeHotelName(h.name), JSON.stringify(h)]));
      tx.zadd(keys.prices, ...scoreMembers)
        .hset(keys.offers, offers)
        .expire(keys.prices, this.ttlSeconds)
        .expire(keys.offers, this.ttlSeconds);
    }

    const results = await tx.exec();
    if (!results) throw new Error('Redis transaction was aborted');
    const failure = results.find(([err]) => err);
    if (failure?.[0]) throw failure[0];
  }

  /** Hotels for a city whose price is within [minPrice, maxPrice] (both inclusive, both optional), cheapest first. */
  async findByPrice(city: string, range: PriceRange): Promise<HotelOffer[]> {
    const keys = hotelKeys(city);
    const min = range.minPrice === undefined ? '-inf' : String(range.minPrice);
    const max = range.maxPrice === undefined ? '+inf' : String(range.maxPrice);
    const rows = await this.redis.filterHotelsByPrice(keys.prices, keys.offers, min, max);
    return rows.filter((row): row is string => row !== null).map((row) => JSON.parse(row) as HotelOffer);
  }
}
