import {Logger} from 'winston';
import {LoggerService} from './services/logger.service';
import {LocalSocketService} from './services/local-socket.service';
import {DeviceStorageService} from './services/device-storage.service';
import {EventService} from './services/event.service';
import {RemoteSocketService} from './services/remote-socket.service';
import {RestService} from './services/rest.service';
import {DeviceCommandService} from './services/device-command-service';
import {SchedulerService} from './services/scheduler.service';
import {MqttService} from './services/mqtt.service';
import {UDPBroadcastService} from './services/udp-broadcast.service';

const log: Logger = new LoggerService().getLogger();
log.info('Starting Ambientika local cloud');

const eventService = new EventService(log);
const deviceStorageService: DeviceStorageService = new DeviceStorageService(log, eventService);
const schedulerService = new SchedulerService(log, deviceStorageService, eventService);
const mqttService = new MqttService(log, eventService, deviceStorageService);
const restService = new RestService(log, deviceStorageService, eventService);
new DeviceCommandService(log, deviceStorageService, eventService);
const localSocketService = new LocalSocketService(log, eventService);
const remoteSocketService = new RemoteSocketService(log, eventService);
const udpBroadcastService = new UDPBroadcastService(log, eventService);

process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', reason);
});

process.on('uncaughtException', (error) => {
    log.error('Uncaught exception — shutting down', error);
    shutdown(1);
});

let shuttingDown = false;

function shutdown(exitCode: number): void {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;

    const hardExitTimer = setTimeout(() => {
        log.error('Graceful shutdown timed out — forcing exit');
        process.exit(exitCode);
    }, 10000);
    hardExitTimer.unref();

    (async () => {
        try {
            localSocketService.close();
            udpBroadcastService.close();
            schedulerService.close();
            await mqttService.close();
            remoteSocketService.close();
            await restService.close();
            await deviceStorageService.close();
        } catch (error) {
            log.error('Error during shutdown', error);
        } finally {
            clearTimeout(hardExitTimer);
            process.exit(exitCode);
        }
    })();
}

process.on('SIGTERM', () => {
    log.info('Received SIGTERM, shutting down gracefully');
    shutdown(0);
});

process.on('SIGINT', () => {
    log.info('Received SIGINT, shutting down gracefully');
    shutdown(0);
});
