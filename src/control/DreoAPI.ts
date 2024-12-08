import axios from 'axios';
import axiosRetry from 'axios-retry';
import MD5 from 'crypto-js/md5';
import ReconnectingWebSocket from 'reconnecting-websocket';
import WebSocket from 'ws';
import { Logger, ILogObj } from 'tslog';
import EventEmitter from 'events';

/**
 * DreoAPI is based heavily on https://github.com/zyonse/homebridge-dreo
 * This file is manually sync'ed from the homebridge-dreo source
 * 
 * History:
 * 2024.11.27 - synchronizing with homebridge-dreo v4.0.4
 *     Note: Hacking commit c45768a: the list device API seems odd.
 *           Using something that matches 'getState' instead
 * 2024.10.05 - synchronizing with homebridge-dreo v3.3.3
 */

// Configure retry capabilities
axiosRetry(axios, {
    retries: 3,
    retryDelay: () => 100,
    shouldResetTimeout: true,
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.code === "ECONNABORTED";
    },
});

type DreoAuth = {
  // Data object returned from the Authenticate call
  access_token: string,
  refresh_token: string,
  countryCode: string,
  scope: string,
  token_type: string,
  region: string,
  expires_in: number,
  userid: string
}

export type DreoConfig = {
  logger: Logger<ILogObj>,
  server: string,
  email: string,
  password: string
}

type DreoDeviceAPI = {
  deviceId: string, 
  sn: string, 
  brand: string,
  model: string,
  productId: string,
  productName: string,
  shared: boolean,
  deviceName: string,
  series?: string,
  seriesName: string
}

export type DreoDevice = {
  deviceId: string, 
  serialNumber: string, 
  brand: string,
  model: string,
  productId: string,
  productName: string,
  shared: boolean,
  deviceName: string,
  series?: string,
  seriesName: string
}

// This is a subset of the state returned by the API
export type DreoState = {
  childlockon: boolean,
  connected: boolean,
  cruiseconf: string,
  fixedconf: string,
  hoscadj: number,
  lightsensoron: boolean,
  mcuon: boolean,
  mode: number,
  muteon: boolean,
  oscmode: number,
  poweron: boolean,
  productId: string,
  serialNumber: string, 
  temperature: number,
  voscadj: number,
  windlevel: number
}

export enum AirCirculatorOscillation { 'NONE', 'HORIZONTAL', 'VERTICAL', 'HORIZONTAL_VERTICAL' }
export enum AirCirculatorMode { 'NORMAL' = 1, 'NATURAL', 'SLEEP', 'AUTO', 'TURBO' }
export enum AirCirculatorCalibration { 'HORIZONTAL', 'VERTICAL', 'HORIZONTAL_VERTICAL' }

export type DreoCommand = {
  oscmode: AirCirculatorOscillation,
  windlevel: number,
  fixedconf: string,
  cruiseconf: string,
  mode?: AirCirculatorMode,
  muteon?: boolean,
  childlockon?: boolean,
  lightsensoro?: boolean,
}

type StateCache = {
  state: DreoState,
  expiry: number,
}

// Typescript sleep
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// API details
const DREO_API_CONFIG = {
    ua: 'dreo/2.8.1 (iPhone; iOS 18.0.0; Scale/3.00)',
    lang: 'en',
    content_type: 'application/json; charset=UTF-8',
    accept_encoding: 'gzip',
    user_agent: 'okhttp/4.9.1',
    timeout: 4000
}

// Follows same request structure as the mobile app
export class DreoAPI extends EventEmitter {
  private config: DreoConfig;
  private auth: DreoAuth | undefined;
  private webSocket: ReconnectingWebSocket | undefined;
  private webSocketTimer: NodeJS.Timeout;
  private stateCache: StateCache | undefined;
  private stateCacheDuration: 5000;
  
  constructor(options: DreoConfig) {
    super();
    this.config = options;
    this.config.password = MD5(options.password).toString();
  }

  // Left to right: 5 degrees/sec or 0.005 degres/ms
  // bottom to top: 5 degrees/sec or 0.005 degres/ms
  /**
   * Auxiliary function to estimate the time to move from the fan's current position to the given
   * coordinates. Based on empirical data, the fan moves at about 5 degrees per second.
   *  
   * @param serialNumber The device serial number
   * @param newH         The new horizontal position
   * @param newV         The new vertical position
   * @returns The delay in milliseconds to wait before the next command can be issued
   */
  protected async getTimerMove(serialNumber: string, newH: number, newV: number): Promise<number> {
    const state = await this.getState(serialNumber);
    const fixedconf = state?.fixedconf.split(',') || ['0','0']; // fixedconf[0] is vertical, fixedconf[1] is horizontal
    const oldH = parseInt(fixedconf[1]) | 0;
    const oldV = parseInt(fixedconf[0]) | 0;
    return (Math.abs(newV - oldV) + Math.abs(newH - oldH)) / 5 * 1000;
  }
  
  // Get authentication token
  protected async authenticate(): Promise<void> {
    if (this.auth) return;
    // axios.interceptors.request.use(request => {
    //   console.log('Starting Request', JSON.stringify(request, null, 2));
    //   return request;
    // });
    // axios.interceptors.response.use(response => {
    //   console.log('Response:', response);
    //   return response
    // });
    await axios.post(`https://app-api-${this.config.server}.dreo-cloud.com/api/oauth/login`, {
      'client_id': 'd8a56a73d93b427cad801116dc4d3188',
      'client_secret': '2ac9b179f7e84be58bb901d6ed8bf374',
      'email': this.config.email,
      'encrypt': 'ciphertext',
      'grant_type': 'email-password',
      'himei': '463299817f794e52a228868167df3f34',
      'password': this.config.password,
      'scope': 'all',
    }, {
      params: {
        'timestamp': Date.now(),
      },
      headers: {
        'ua': DREO_API_CONFIG.ua,
        'lang': DREO_API_CONFIG.lang,
        'content-type': DREO_API_CONFIG.content_type,
        'accept-encoding': DREO_API_CONFIG.accept_encoding,
        'user-agent': DREO_API_CONFIG.user_agent,
      },
      timeout: DREO_API_CONFIG.timeout,
    })
    .then((response) => {
      const payload = response.data;
      if (payload.data && payload.data.access_token) {
        // Success
        this.auth = payload.data as DreoAuth;
      } else {
        this.config.logger.error('Error retrieving token:', payload);
        throw new Error('Error retrieving token');
      }
    })
    .catch((error) => {
      this.config.logger.error('Error retrieving token:', error.data);
      throw new Error('Error retrieving token');
    });
  }
      
  // open websocket for outgoing fan commands, websocket will auto-reconnect if a connection error occurs
  // websocket is also used to monitor incoming state changes from hardware controls
  protected async startWebSocket(): Promise<void> {
    if (this.webSocket) return;
    await this.authenticate();
    // open websocket
    const url = `wss://wsb-${this.config.server}.dreo-cloud.com/websocket?accessToken=${this.auth?.access_token}&timestamp=${Date.now()}`;
    this.config.logger.debug('Start web socket...');
    this.webSocket = new ReconnectingWebSocket(url, [], { WebSocket: WebSocket });
  
    this.webSocket.addEventListener('error', (error) => {
      this.config.logger.debug('WebSocket Error', error);
      this.emit('error', error);
    });
  
    this.webSocket.addEventListener('open', () => {
      this.config.logger.debug('WebSocket Opened');
      this.emit('open');
    });
  
    this.webSocket.addEventListener('close', () => {
      this.config.logger.debug('WebSocket Closed');
      this.emit('close');
    });

    this.webSocket.addEventListener('message', (message) => {
      this.config.logger.debug('WebSocket Message');
      // Reset state cache
      if (this.stateCache) this.stateCache.expiry = 0;
      this.emit('message', message);
    });
  
    // keep connection open by sending empty packet every 15 seconds
    this.webSocketTimer = setInterval(() => this.webSocket?.send('2'), 15000);
  }

  private async sendCommand(serialNumber: string, parameters: object, wait: number): Promise<void> {
    if (!this.webSocket) await this.startWebSocket();
    const message = JSON.stringify({
      'devicesn': serialNumber,
      'method': 'control',
      'params': parameters,
      'timestamp': Date.now()
    });
    this.config.logger.debug('DreoAPI sendCommand', JSON.stringify(message));
    this.webSocket?.send(message);
    await sleep(wait); // wait for the operation to complete
  }

  public async disconnect(): Promise<void> {
    this.config.logger.debug('DreoAPI disconnecting');
    // Turn the fan off
    clearInterval(this.webSocketTimer);

    const closePromise = new Promise<void>((resolve) => {
      if (this.webSocket) this.webSocket.onclose = () => {
        this.config.logger.debug('DreoAPI disconnected');
        resolve();
      };
    })
    this.webSocket?.close();
    this.webSocket = undefined;
    this.auth = undefined;
    return closePromise;
  }

  // Return device list
  public async getDevices(): Promise<Array<DreoDevice>> {
    this.config.logger.debug('DreoAPI getDevices');
    await this.authenticate();
    let devices: Array<DreoDevice> = [];
    await axios.get(`https://app-api-${this.config.server}.dreo-cloud.com/api/user-device/device/list`, {
      params: {
        'timestamp': Date.now(),
      },
      headers: {
        'authorization': `Bearer ${this.auth?.access_token}`,
        'ua': DREO_API_CONFIG.ua,
        'lang': DREO_API_CONFIG.lang,
        'accept-encoding': DREO_API_CONFIG.accept_encoding,
        'user-agent': DREO_API_CONFIG.user_agent,
      },
      timeout: DREO_API_CONFIG.timeout,
    })
    // Catch and log errors
    .then((response) => {
      const payload = response.data;
      if (payload.data && payload.data.list) {
        devices = payload.data.list.map((device: DreoDeviceAPI) => {
          return (({ deviceId, sn, brand, model, productId, productName, deviceName, shared, series, seriesName }) => ({ 
            deviceId, 
            serialNumber: sn, 
            brand, 
            model, 
            productId, 
            productName, 
            deviceName, 
            shared, 
            series, 
            seriesName 
          }))(device);
        });
      } else {
        this.config.logger.error('Error retrieving device list:', payload);
        throw new Error('Unable to retrieve device list - API returned 200');
      }
    })
    .catch((error) => {
      this.config.logger.error('Error retrieving device list:', error);
      throw new Error('Unable to retrieve device list');
    });
    return devices;
  }

  // used to initialize power state, speed values on boot
  public async getState(serialNumber: string): Promise<DreoState|null> {
    if (this.stateCache && Date.now() < this.stateCache.expiry) {
      this.config.logger.debug('DreoAPI getState [cache]', serialNumber);
      return this.stateCache.state;
    }

    this.config.logger.debug('DreoAPI getState', serialNumber);
    await this.authenticate();
    let state: DreoState | null = null;
    await axios.get(`https://app-api-${this.config.server}.dreo-cloud.com/api/user-device/device/state`, {
      params: {
        'deviceSn': serialNumber,
        'timestamp': Date.now(),
      },
      headers: {
        'authorization': 'Bearer ' + this.auth?.access_token,
        'ua': DREO_API_CONFIG.ua,
        'lang': DREO_API_CONFIG.lang,
        'accept-encoding': DREO_API_CONFIG.accept_encoding,
        'user-agent': DREO_API_CONFIG.user_agent,
      },
      timeout: DREO_API_CONFIG.timeout,
    })
    .then((response) => {
      const payload = response.data;
      if (payload.data && payload.data.productId) {
        state = (({ sn, productId, /*region,*/ mixed }) => ({ 
            childlockon: mixed.childlockon.state,
            connected: mixed.connected.state,
            cruiseconf: mixed.cruiseconf.state,
            fixedconf: mixed.fixedconf.state,
            hoscadj: mixed.hoscadj.state,
            lightsensoron: mixed.lightsensoron.state,
            mcuon: mixed.mcuon.state,
            mode: mixed.mode.state,
            muteon: mixed.muteon.state,
            oscmode: mixed.oscmode.state,
            poweron: mixed.poweron.state, 
            productId, 
            serialNumber: sn, 
            temperature: mixed.temperature.state,
            voscadj: mixed.timeroff.state,
            windlevel: mixed.windlevel.state
           }))(payload.data);
      } else {
        this.config.logger.error('Error retrieving device state:', payload);
        throw new Error('Unable to retrieve device state - API returned 200');
      }
    })
    .catch((error) => {
      this.config.logger.error('Error retrieving device state:', error);
      throw new Error('Unable to retrieve device state');
    });
    if (state) {
      this.stateCache = { expiry: Date.now() + this.stateCacheDuration, state: state };
    }
    return state;
  }

  public async getTemperature(deviceSn: string): Promise<number|undefined> {
    this.config.logger.debug('DreoAPI getTemperature', deviceSn);
    const state = await this.getState(deviceSn);
    return state?.temperature as number;
  }

  public async airCirculatorCommand(deviceSn: string, command: DreoCommand): Promise<void> {
    // Ensure wind level is within acceptable range
    command.windlevel = command.windlevel < 1 ? 1 : command.windlevel > 9 ? 9 : command.windlevel
    this.config.logger.debug('DreoAPI airCirculatorCommand', deviceSn, command);
    await this.sendCommand(deviceSn, command, 1000);
  }

  public async airCirculatorPowerOn(deviceSn: string, powerOn: boolean): Promise<void> {
    this.config.logger.debug('DreoAPI airCirculatorPowerOn', deviceSn, powerOn);
    const state = await this.getState(deviceSn);
    if (state?.poweron !== powerOn) {
      await this.sendCommand(deviceSn, {'poweron': powerOn}, 500);
    }
  }

  public async airCirculatorOscillate(deviceSn: string, oscillation: AirCirculatorOscillation): Promise<void> {
    this.config.logger.debug('DreoAPI airCirculatorOscillate', deviceSn, oscillation);
    await this.sendCommand(deviceSn, {'oscmode': oscillation}, 3000);
  }

  /**
   * This function takes a tuple for the horizontal and vertical angle.
   * 
   * @param deviceSn Device serial number
   * @param position Position tuple where [0] is the horizontal angle, and [1] is the vertical angle
   *                 Examples:
   *                 [-45, 0]: Fan will move to position horizontal -45 degrees, vertical 0 degrees
   *                 [60, 45]: Fan will move to position horizontal 60 degrees, vertical 45 degrees
   *                 Note: Horizontal range is [-60..60] and vertical range is [0..90]
   */
  public async airCirculatorPosition(deviceSn: string, position: [number, number]): Promise<void> {
    this.config.logger.debug('DreoAPI airCirculatorPosition', deviceSn, position);
    const hAngle = position[0] < -60 ? -60 : position[0] > 60 ? 60 : position[0];
    const vAngle = position[1] < 0 ? 0 : position[1] > 90 ? 90 : position[1];
    await this.airCirculatorOscillate(deviceSn, AirCirculatorOscillation.NONE); // stop oscillation first
    const delay = 15000; // Need to wait about 15s before a 'fixedconf' command follows a change in oscillation 
    await this.sendCommand(deviceSn, {'fixedconf': `${vAngle.toString()},${hAngle.toString()}`}, delay); // positioning the fan might take a while
  }

  /**
   * Different than the Dreo API, this function takes a tuple for horizontal and a tuple for vertical.
   * 
   * @param deviceSn    Device serial number
   * @param horizontal  Horizontal tuple where [0] is the direction and [1] is the oscillating angle
   *                    Examples: 
   *                    [0, 60]  : Fan will oscillate between horizontal angles -30 and 30
   *                    [-10, 30]: Fan will oscillate between horizontal angles -25 and 5
   *                    [10, 60] : Fan will oscillate between horizontal angles -20 and 40
   *                    Note: Oscillating angles cannot exceed -60 and 60, and the minimum value for horizontal[1] is 30
   * @param vertical    Horizontal tuple where [0] is the direction and [1] is the oscillating angle
   *                    Examples:
   *                    [15, 30]: Fan will oscillate between vertical angles 0 and 15
   *                    [30, 60]: Fan will oscillate between vertical angles 0 and 30
   *                    [30, 30]: Fan will oscillate between vertical angles 15 and 45
   *                    Note: Oscillating angles cannot exceed 0 and 90, and the minimum value for vertical[1] is 30
   */
  public async airCirculatorCruise(deviceSn: string, horizontal: [number, number], vertical: [number, number]): Promise<void> {
    this.config.logger.debug('DreoAPI airCirculatorCruise', deviceSn, horizontal, vertical);
    const hDirection = horizontal[0];
    const hAngle = horizontal[1] < 30 ? 30 : horizontal[1] > 120 ? 120 : horizontal[1];
    const hMin = Math.max(hDirection - Math.floor(hAngle / 2), -60);
    const hMax = Math.min(hMin + hAngle, 60);

    const vDirection = vertical[0];
    const vAngle = vertical[1];
    const vMin = Math.max(vDirection - Math.floor(vAngle / 2), 0);
    const vMax = Math.min(vMin + vAngle, 90);

    const cruiseconf = `${vMax.toString()},${hMax.toString()},${vMin.toString()},${hMin.toString()}`;
    await this.sendCommand(deviceSn, {'cruiseconf': cruiseconf}, 1000);
  }

  public async airCirculatorSpeed(deviceSn: string, speed: number): Promise<void> {
    this.config.logger.debug('DreoAPI airCirculatorSpeed', deviceSn, speed);
    const windLevel = speed < 1 ? 1 : speed > 9 ? 9 : speed;
    await this.sendCommand(deviceSn, {'windlevel': windLevel}, 0);
  }

  public async airCirculatorMode(deviceSn: string, mode: AirCirculatorMode): Promise<void> {
    this.config.logger.debug('DreoAPI airCirculatorMode', deviceSn, mode);
    await this.sendCommand(deviceSn, {'mode': mode}, 1000);
  }

  public async airCirculatorCalibrate(deviceSn: string, orientation: AirCirculatorCalibration): Promise<void> {
    this.config.logger.debug('DreoAPI airCirculatorCalibrate', deviceSn, orientation);
    await this.airCirculatorOscillate(deviceSn, AirCirculatorOscillation.NONE); // stop oscillation first
    if (orientation === AirCirculatorCalibration.HORIZONTAL_VERTICAL) {
      await this.airCirculatorCalibrate(deviceSn, AirCirculatorCalibration.HORIZONTAL);
      await this.airCirculatorCalibrate(deviceSn, AirCirculatorCalibration.VERTICAL);
    } else if (orientation === AirCirculatorCalibration.HORIZONTAL) {
      const calibration = ',0';
      const delay = await this.getTimerMove(deviceSn, 120, 0);
      await this.sendCommand(deviceSn, {'fixedconf': calibration}, delay); // calibration is slow
    } else {
      const calibration = '0,';
      const delay = await this.getTimerMove(deviceSn, 0, 180);
      await this.sendCommand(deviceSn, {'fixedconf': calibration}, delay); // calibration is slow
    }
  }
}