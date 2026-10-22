export class ForgePilotError extends Error {
    constructor(message, code = "FORGEPILOT_ERROR") {
        super(message);
        this.name = "ForgePilotError";
        this.code = code;
    }
}
