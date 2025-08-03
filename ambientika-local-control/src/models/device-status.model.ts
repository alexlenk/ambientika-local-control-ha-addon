export class DeviceStatus {
    operatingMode: string;
    fanSpeed: string;
    humidityLevel: string;
    temperature: number;
    humidity: number;
    airQuality: number;
    humidityAlarm: boolean;
    filterStatus: number;
    nightAlarm: boolean;
    deviceRole: string;
    lastOperatingMode: string;
    lightSensitivity: number;


    constructor(operatingMode: string, fanSpeed: string, humidityLevel: string, temperature: number,
                humidity: number, airQuality: number, humidityAlarm: boolean, filterStatus: number, nightAlarm: boolean,
                deviceRole: string, lastOperatingMode: string, lightSensitivity: number) {
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
    }
}
