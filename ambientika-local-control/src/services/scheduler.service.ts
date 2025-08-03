import * as schedule from 'node-schedule';
import {Logger} from 'winston';
import {DeviceStorageService} from './device-storage.service';
import {EventService} from './event.service';
import {DeviceDto} from '../dto/device.dto';
import {Duration, Instant} from '@js-joda/core';
import dotenv from 'dotenv'
import {Spec} from 'node-schedule';
import {DeviceMapper} from './device.mapper';

dotenv.config()

export class SchedulerService {

    private cronExpression = process.env.SCHEDULER_CRON as Spec;
    private deviceStaleTimeout: number = parseInt(process.env.DEVICE_STALE_TIMEOUT || '60');
    private deviceMapper: DeviceMapper;

    constructor(private log: Logger,
                private deviceStorageService: DeviceStorageService,
                private eventService: EventService) {
        this.log.debug(`Initializing SchedulerService with cron ${this.cronExpression}`);
        this.deviceMapper = new DeviceMapper(this.log);
        schedule.scheduleJob(this.cronExpression, () => {
            this.deviceStorageService.getDevices((devices: DeviceDto[]) => {
                if (devices) {
                    devices.forEach((deviceDto: DeviceDto) => {
                        const lastUpdateInstant = Instant.parse(deviceDto.lastUpdate);
                        if (lastUpdateInstant) {
                            const lastUpdateDuration = Duration.between(lastUpdateInstant, Instant.now());
                            if (lastUpdateDuration.seconds() > this.deviceStaleTimeout) {
                                const device = this.deviceMapper.deviceFromDto(deviceDto);
                                this.eventService.deviceOffline(device);
                            }
                        }
                    });
                }
            });
        });

    }
}
