import {Logger} from 'winston';
import dotenv from 'dotenv'
import {DeviceStorageService} from './device-storage.service';
import express, {Response, Request} from 'express';
import {EventService} from './event.service';
import {OperatingModeDto} from '../dto/operating-mode.dto';
import {DeviceDto} from '../dto/device.dto';
import {WeatherUpdateDto} from '../dto/weather-update.dto';

dotenv.config()

export class RestService {
    constructor(private log: Logger,
                private deviceStorageService: DeviceStorageService,
                private eventService: EventService) {
        this.init();
    }

    private init(): void {
        this.log.debug('Initializing RestService');
        const port = process.env.REST_API_PORT || 3000;
        const app = express();
        app.use(express.json());
        app.listen(port, () => {
            this.log.debug(`Rest service listening on port: ${port.toString()}`);
        });
        app.get("/device/status/:serialNumber", (request: Request, response: Response) => {
            this.deviceStorageService.findExistingDeviceBySerialNumber(request.params.serialNumber,
                (existingDevice: DeviceDto | undefined) => {
                    if (existingDevice) {
                        response.status(200).send(existingDevice);
                    } else {
                        response.status(404).send('Not Found');
                    }
                });
        });

        app.post("/device/operating-mode/:serialNumber", (request: Request, response: Response) => {
            this.eventService.deviceOperatingModeUpdate(request.body as OperatingModeDto, request.params.serialNumber);
            response.send();

        });

        app.post("/device/reset-filter/:serialNumber", (request: Request, response: Response) => {
            this.eventService.deviceFilterReset(request.params.serialNumber);
            response.send();
        });

        app.post("/device/weather-update", (request: Request, response: Response) => {
            this.eventService.deviceWeatherUpdate(request.body as WeatherUpdateDto);
            response.send();
        });

        // Debug: inject 16-byte setup packet into cloud socket for a device
        // POST /cloud/send-setup/8813bf16089c  body: {"role":0,"zone":1,"houseId":12048}
        app.post("/cloud/send-setup/:serialNumber", (request: Request, response: Response) => {
            const serialNumber = request.params.serialNumber.toLowerCase();
            const { role = 0, zone = 0, houseId = 0 } = request.body;
            this.deviceStorageService.findExistingDeviceBySerialNumber(serialNumber, (device) => {
                if (!device || !device.remoteAddress) {
                    response.status(404).send('Device not found or no IP');
                    return;
                }
                const serialBytes = Buffer.from(serialNumber, 'hex');
                const buf = Buffer.alloc(16);
                buf.writeUInt8(0x02, 0);
                buf.writeUInt8(0x00, 1);
                serialBytes.copy(buf, 2);
                buf.writeUInt8(0x00, 8);
                buf.writeUInt8(role, 9);
                buf.writeUInt8(zone, 10);
                buf.writeUInt8(0x00, 11);
                buf.writeUInt32LE(houseId, 12);
                this.log.info(`Injecting setup to cloud for ${serialNumber} via ${device.remoteAddress}: ${buf.toString('hex')}`);
                this.eventService.localSocketDataUpdateReceived(buf, device.remoteAddress);
                response.status(200).send({ sent: buf.toString('hex'), via: device.remoteAddress });
            });
        });
    }
}
