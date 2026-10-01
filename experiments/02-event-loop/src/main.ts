// Variants 1 and 3: a single process.
import { bootstrap } from './server.js';

await bootstrap();
console.log(`listening, pid ${process.pid}`);
