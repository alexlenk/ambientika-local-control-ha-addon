import {Instant} from '@js-joda/core';

export class Device {
    serialNumber: string;
    operatingMode: string;
    fanSpeed: string;
    humidityLevel: string;
    temperature: number;
    humidity: number;
    airQuality: string;
    humidityAlarm: boolean;
    filterStatus: string;
    nightAlarm: boolean;
    deviceRole: string;
    lastOperatingMode: string;
    lightSensitivity: string;
    remoteAddress: string;
    signalStrength: number;
    houseId: number;
    zoneId: number;
    lastUpdate: Instant;
    firstSeen: Instant;

    constructor(serialNumber: string, operatingMode: string, fanSpeed: string, humidityLevel: string, temperature: number,
                humidity: number, airQuality: string, humidityAlarm: boolean, filterStatus: string, nightAlarm: boolean,
                deviceRole: string, lastOperatingMode: string, lightSensitivity: string, remoteAddress: string, signalStrength: number,
                houseId: number, zoneId: number) {
        this.serialNumber = serialNumber;
        this.operatingMode = operatingMode;
        this.fanSpeed = fanSpeed;
        this.humidityLevel = humidityLevel;
        this.temperature = temperature;
        this.humidity = humidity;
        this.airQuality = airQuality;
        this.humidityAlarm = humidityAlarm;
        this.filterStatus = filterStatus;
        this.nightAlarm = nightAlarm;
        this.deviceRole = deviceRole;
        this.lastOperatingMode = lastOperatingMode;
        this.lightSensitivity = lightSensitivity;
        this.remoteAddress = remoteAddress;
        this.signalStrength = signalStrength;
        this.houseId = houseId;
        this.zoneId = zoneId;
    }

    equals(device: Device): boolean {
        return this.serialNumber === device.serialNumber;
    }
}
