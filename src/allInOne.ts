// Runs the Temporal worker and the HTTP API in a single Node process.
// Used for single-container hosting (e.g. Render's free plan, see Dockerfile.render);
// docker-compose runs them as separate containers instead.
import './temporal/worker';
import './api/server';
