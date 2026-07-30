import winston, {Logger} from 'winston';

// Device serials are effectively credentials in this ecosystem (the vendor protocol
// is unauthenticated and devices are addressed purely by serial), so they're masked
// in all log output by default — keeping the last 4 hex chars so multiple devices
// stay distinguishable in logs. Set LOG_FULL_SERIALS=true to disable.
const registeredSerials = new Set<string>();

export function registerSerialForMasking(serialNumber: string | undefined): void {
    if (serialNumber) {
        registeredSerials.add(serialNumber.toLowerCase());
    }
}

function maskSerial(serial: string): string {
    return `xxxxxxxx${serial.slice(-4)}`;
}

export function maskSerialsInMessage(message: string): string {
    let masked = message;
    for (const serial of registeredSerials) {
        if (masked.includes(serial)) {
            masked = masked.split(serial).join(maskSerial(serial));
        }
    }
    // Safety net for serials not yet registered — only matches a standalone 12-hex-char
    // token (word boundaries), so it won't chew through the middle of a longer hex dump
    // (registered-serial substring replacement above handles that case instead).
    return masked.replace(/\b[0-9a-f]{12}\b/gi, (match) => maskSerial(match.toLowerCase()));
}

export const maskSerials = winston.format((info) => {
    if (process.env.LOG_FULL_SERIALS === 'true') {
        return info;
    }
    if (typeof info.message === 'string') {
        info.message = maskSerialsInMessage(info.message);
    }
    return info;
});

export class LoggerService {
    private readonly logger: Logger;

    constructor() {
        // Get log level from environment variable, default to 'info'
        const logLevel = process.env.LOG_LEVEL || 'info';

        this.logger = winston.createLogger({
            level: logLevel,
            format: winston.format.combine(
                winston.format.splat(),
                maskSerials(),
                winston.format.colorize(),
                winston.format.timestamp(),
                winston.format.printf(({level, message, timestamp}) => {
                    return `${timestamp} [${level}] : ${message} `
                })
            ),
            transports: [new winston.transports.Console()],
        });
        this.logger.info(`Init LoggerService with level: ${logLevel}`);
    }

    getLogger(): Logger {
        return this.logger;
    }
}
