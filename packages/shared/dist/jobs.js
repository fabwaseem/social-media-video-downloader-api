"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TERMINAL_STATUSES = exports.JOB_STATUSES = void 0;
exports.isTerminalStatus = isTerminalStatus;
exports.JOB_STATUSES = [
    "QUEUED",
    "FETCHING_INFO",
    "DOWNLOADING",
    "CONVERTING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
    "EXPIRED",
];
exports.TERMINAL_STATUSES = ["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"];
function isTerminalStatus(status) {
    return exports.TERMINAL_STATUSES.includes(status);
}
