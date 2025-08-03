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
    }
}
