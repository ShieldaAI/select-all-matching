import { parentPort, workerData } from "node:worker_threads";
import { decodeSelection, encodeSelection } from "select-all-matching";

const decoded = decodeSelection(workerData);
if (!decoded.ok) throw new Error(`Worker could not decode selection: ${decoded.error.code}`);
parentPort.postMessage(encodeSelection(decoded.value));
