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
new SchedulerService(log, deviceStorageService, eventService);
new MqttService(log, eventService, deviceStorageService);
new RestService(log, deviceStorageService, eventService);
new DeviceCommandService(log, deviceStorageService, eventService);
new LocalSocketService(log, eventService);
new RemoteSocketService(log, eventService);
new UDPBroadcastService(log, eventService);

