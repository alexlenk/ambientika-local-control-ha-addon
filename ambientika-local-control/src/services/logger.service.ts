import winston, {Logger} from 'winston';

export class LoggerService {
    private readonly logger: Logger;

    constructor() {
        this.logger = winston.createLogger({
            level: "silly",
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
        this.logger.info('Init LoggerService');
    }

    getLogger(): Logger {
        return this.logger;
    }
}

