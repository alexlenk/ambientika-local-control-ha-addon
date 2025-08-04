import winston, {Logger} from 'winston';

export class LoggerService {
    private readonly logger: Logger;

    constructor() {
        // Get log level from environment variable, default to 'info'
        const logLevel = process.env.LOG_LEVEL || 'info';
        
        this.logger = winston.createLogger({
            level: logLevel,
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.splat(),
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

