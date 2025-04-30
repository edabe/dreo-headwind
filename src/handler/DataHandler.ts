export type PowerData = {
    power: number,
    powerMax: number,
    powerZone: number,
    powerZoneTime: number
}

export type HeartRateData = {
    heartRate: number,
    heartRateMax: number,
    heartRateZone: number,
    heartRateZoneTime: number
}

export type CadenceData = {
    cadence: number,
    cadenceMax: number
}

export type PerformanceData = PowerData & HeartRateData & CadenceData & {
    normalizedPower: number,
    averagePower: number,
    averageHeartRate: number,
    averageCadence: number,
    intensityFactor: number,
    trainingStressScore: number
}

export type EnvironmentData = {
    temperatureC: number,
    temperatureF: number,
    humidityPercent: number
}

export type EventData = {
    cadence?: number;
    heartRate?: number;
    averagePower?: number;
}

/**
 * Declares the public interface that defines a performance data handler.
 * 
 * The handler will receive physiology data (HR, power, cadnece) as well as 
 * environment data (temperature, humidity).
 */
export abstract class PerformanceHandler {
    /**
     * The performance data handler.
     * AntConnector will call this function approximately once every second.
     * 
     * @param performance The object containing physiology data.
     * @param environment The object containing environment data.
     */
    public abstract onPerformanceData(performance: PerformanceData, environment: EnvironmentData): void;

    /**
     * Cleanup function.
     * This should implement the asynchronous logic to clean up and reset the data handler.
     */
    public abstract cleanUp(): Promise<void>;
}

/**
 * Declares the public interface that defines a sensor event handler.
 * 
 * The handler will receive aggregated data from the heart rate, power meter and cadence
 * ANT sensors (HR, Power and Cadence profiles).
 */
export abstract class SensorHandler {
    /**
     * The event data handler from ANT sensors.
     * AntConnector will call this function approximately 4 times every second.
     * 
     * @param event The aggregated ANT sensor data (HR, Power and Cadence profiles).
     */
    public abstract onEventData(event: EventData): void;

    /**
     * Cleanup function.
     * This should implement the asynchronous logic to clean up and reset the data handler.
     */
    public abstract cleanUp(): Promise<void>;
}