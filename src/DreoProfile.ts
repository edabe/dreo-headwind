/**
 * Defines different profiles for the Dreo air circulator.
 * A profile is a set of oscilating configurations to be
 * applied to the air circulator.
 */
import { AirCirculatorOscillation, DreoAPI } from "./DreoAPI";

// This is the cruise parameters used in this context
// Horizontal -15 to 15
// Vertical 15 to 65
const CRUISE_HORIZONTAL: [number, number] = [0, 30];
const CRUISE_VERTICAL: [number, number] = [45, 30];

export abstract class DreoProfile {
    name: string;
    abstract apply(dreoSerialNumber: string, dreoApi: DreoAPI): void;
    toString(): string {
        return this?.name;
    }
}

class OscillateHorizontalProfile extends DreoProfile {
    name = 'OSCILATE_HORIZONTAL';
    apply(serialNumber: string, dreoApi: DreoAPI) {
        (async () => {
            await dreoApi.airCirculatorPowerOn(serialNumber, true);
            await dreoApi.airCirculatorPosition(serialNumber, [0, 45]);
            await dreoApi.airCirculatorOscillate(serialNumber, AirCirculatorOscillation.HORIZONTAL);
            await dreoApi.airCirculatorCruise(serialNumber, AirCirculatorOscillation.HORIZONTAL, CRUISE_HORIZONTAL, CRUISE_VERTICAL);
        })();
    }
}

class OscillateVerticalProfile extends DreoProfile {
    name = 'OSCILATE_VERTICAL';
    apply(serialNumber: string, dreoApi: DreoAPI) {
        (async () => {
            await dreoApi.airCirculatorPowerOn(serialNumber, true);
            await dreoApi.airCirculatorPosition(serialNumber, [0, 45]);
            await dreoApi.airCirculatorOscillate(serialNumber, AirCirculatorOscillation.HORIZONTAL);
            await dreoApi.airCirculatorCruise(serialNumber, AirCirculatorOscillation.VERTICAL, CRUISE_HORIZONTAL, CRUISE_VERTICAL);
        })();
    }
}

class OscillateHorizontalVerticalProfile extends DreoProfile {
    name = 'OSCILATE_HORIZONTAL_VERTICAL';
    apply(serialNumber: string, dreoApi: DreoAPI) {
        (async () => {
            await dreoApi.airCirculatorPowerOn(serialNumber, true);
            await dreoApi.airCirculatorOscillate(serialNumber, AirCirculatorOscillation.HORIZONTAL);
            await dreoApi.airCirculatorCruise(serialNumber, AirCirculatorOscillation.HORIZONTAL_VERTICAL, CRUISE_HORIZONTAL, CRUISE_VERTICAL);
        })();
    }
}

class Center45Degrees extends DreoProfile {
    name = 'CENTER_45_DEGREE';
    apply(serialNumber: string, dreoApi: DreoAPI) {
        (async () => {
            await dreoApi.airCirculatorPowerOn(serialNumber, true);
            await dreoApi.airCirculatorPosition(serialNumber, [0, 45]);
        })();
    }
}

class Center0Degrees extends DreoProfile {
    name = 'CENTER_0_DEGREE';
    apply(serialNumber: string, dreoApi: DreoAPI) {
        (async () => {
            await dreoApi.airCirculatorPowerOn(serialNumber, true);
            await dreoApi.airCirculatorPosition(serialNumber, [0, 0]);
        })();
    }
}

export enum DreoProfileType { 'CENTER_0', 'CENTER_45', 'HORIZONTAL', 'VERTICAL', 'HORIZONTAL_VERTICAL' }

export const DreoProfiles = {
    [DreoProfileType.HORIZONTAL]: new OscillateHorizontalProfile(),
    [DreoProfileType.VERTICAL]: new OscillateVerticalProfile(),
    [DreoProfileType.HORIZONTAL_VERTICAL]: new OscillateHorizontalVerticalProfile(),
    [DreoProfileType.CENTER_45]: new Center45Degrees(),
    [DreoProfileType.CENTER_0]: new Center0Degrees()
}
