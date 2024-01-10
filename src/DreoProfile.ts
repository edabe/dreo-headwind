/**
 * Defines different profiles for the Dreo air circulator.
 * A profile is a set of oscilating configurations to be
 * applied to the air circulator.
 */
import { AirCirculatorOscillation, DreoAPI } from './DreoAPI';

// This is the cruise parameters used in this context
// Horizontal -15 to 15
// Vertical 15 to 65
const CRUISE_HORIZONTAL: [number, number] = [0, 30];
const CRUISE_VERTICAL: [number, number] = [30, 30];

export abstract class DreoProfile {
    name: string;
    // All implementations must be async
    abstract apply(dreoSerialNumber: string, dreoApi: DreoAPI): Promise<void>;
    toString(): string {
        return this?.name;
    }
}

class OscillateHorizontalProfile extends DreoProfile {
    name = 'OSCILATE_HORIZONTAL';
    async apply(serialNumber: string, dreoApi: DreoAPI) {
        await dreoApi.airCirculatorPowerOn(serialNumber, true);
        await dreoApi.airCirculatorPosition(serialNumber, [0, 30]);
        await dreoApi.airCirculatorCruise(serialNumber, CRUISE_HORIZONTAL, CRUISE_VERTICAL);
        await dreoApi.airCirculatorOscillate(serialNumber, AirCirculatorOscillation.HORIZONTAL);
    }
}

class OscillateVerticalProfile extends DreoProfile {
    name = 'OSCILATE_VERTICAL';
    async apply(serialNumber: string, dreoApi: DreoAPI) {
        await dreoApi.airCirculatorPowerOn(serialNumber, true);
        await dreoApi.airCirculatorPosition(serialNumber, [0, 30]);
        await dreoApi.airCirculatorCruise(serialNumber, CRUISE_HORIZONTAL, CRUISE_VERTICAL);
        await dreoApi.airCirculatorOscillate(serialNumber, AirCirculatorOscillation.VERTICAL);
    }
}

class OscillateHorizontalVerticalProfile extends DreoProfile {
    name = 'OSCILATE_HORIZONTAL_VERTICAL';
    async apply(serialNumber: string, dreoApi: DreoAPI) {
        await dreoApi.airCirculatorPowerOn(serialNumber, true);
        await dreoApi.airCirculatorCruise(serialNumber, CRUISE_HORIZONTAL, CRUISE_VERTICAL);
        await dreoApi.airCirculatorOscillate(serialNumber, AirCirculatorOscillation.HORIZONTAL_VERTICAL);
    }
}

class Center45Degrees extends DreoProfile {
    name = 'CENTER_45_DEGREE';
    async apply(serialNumber: string, dreoApi: DreoAPI) {
        await dreoApi.airCirculatorPowerOn(serialNumber, true);
        await dreoApi.airCirculatorPosition(serialNumber, [0, 45]);
    }
}

class Center30Degrees extends DreoProfile {
    name = 'CENTER_30_DEGREE';
    async apply(serialNumber: string, dreoApi: DreoAPI) {
        await dreoApi.airCirculatorPowerOn(serialNumber, true);
        await dreoApi.airCirculatorPosition(serialNumber, [0, 30]);
    }
}

class Center0Degrees extends DreoProfile {
    name = 'CENTER_0_DEGREE';
    async apply(serialNumber: string, dreoApi: DreoAPI) {
        await dreoApi.airCirculatorPowerOn(serialNumber, true);
        await dreoApi.airCirculatorPosition(serialNumber, [0, 0]);
    }
}

export enum DreoProfileType { 'CENTER_0', 'CENTER_30', 'CENTER_45', 'HORIZONTAL', 'VERTICAL', 'HORIZONTAL_VERTICAL' }

export const DreoProfiles = {
    [DreoProfileType.HORIZONTAL]: new OscillateHorizontalProfile(),
    [DreoProfileType.VERTICAL]: new OscillateVerticalProfile(),
    [DreoProfileType.HORIZONTAL_VERTICAL]: new OscillateHorizontalVerticalProfile(),
    [DreoProfileType.CENTER_45]: new Center45Degrees(),
    [DreoProfileType.CENTER_30]: new Center30Degrees(),
    [DreoProfileType.CENTER_0]: new Center0Degrees()
}
