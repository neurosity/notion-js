import { Observable, fromEventPattern, from, empty } from "rxjs";
import { map, switchMap } from "rxjs/operators";
import firebase from "firebase/app";
import { User } from "@firebase/auth-types";

import { FirebaseApp } from "./FirebaseApp";
import {
  Credentials,
  EmailAndPassword,
  CustomToken
} from "../../types/credentials";
import { UserDevices } from "../../types/user";
import { DeviceInfo } from "../../types/deviceInfo";

const SERVER_TIMESTAMP = firebase.database.ServerValue.TIMESTAMP;

/**
 * @hidden
 */
export const credentialWithLink: Function =
  firebase.auth.EmailAuthProvider.credentialWithLink;

/**
 * @hidden
 */
export function createUser(...args) {
  return new (firebase as any).User(...args);
}

/**
 * @hidden
 */
export class FirebaseUser {
  public app: firebase.app.App;
  public user: User | null;

  constructor(firebaseApp: FirebaseApp) {
    this.app = firebaseApp.app;

    this.app.auth().onAuthStateChanged((user: User | null) => {
      this.user = user;
    });
  }

  public auth() {
    return this.app.auth();
  }

  async createAccount(credentials: EmailAndPassword) {
    const { email, password } = credentials;
    const [error, user] = await this.app
      .auth()
      .createUserWithEmailAndPassword(email, password)
      .then((user) => [null, user])
      .catch((error) => [error, null]);

    if (error) {
      return Promise.reject(error);
    }

    return user;
  }

  async deleteAccount() {
    const user = this.app.auth().currentUser;

    if (!user) {
      return Promise.reject(
        new Error(
          `You are trying to delete an account that is not authenticated. To delete an account, the account must have signed in recently.`
        )
      );
    }

    const [devicesError, devices] = await this.getDevices()
      .then((response) => [null, response])
      .catch((error) => [error, null]);

    if (devicesError) {
      return Promise.reject(devicesError);
    }

    if (devices.length) {
      const removeDeviceError = await Promise.all(
        devices.map((device) => this.removeDevice(device.deviceId))
      )
        .then(() => null)
        .catch((error) => error);

      if (removeDeviceError) {
        return Promise.reject(removeDeviceError);
      }
    }

    return user.delete();
  }

  onAuthStateChanged(): Observable<User | null> {
    return new Observable((observer) => {
      this.app.auth().onAuthStateChanged((user: User | null) => {
        observer.next(user);
      });
    });
  }

  onLogin(): Observable<User> {
    return new Observable((observer) => {
      const unsubscribe = this.app
        .auth()
        .onAuthStateChanged((user: User) => {
          if (!!user) {
            observer.next(user);
            observer.complete();
          }
        });
      return () => unsubscribe();
    });
  }

  login(credentials: Credentials) {
    if ("customToken" in credentials) {
      const { customToken } = credentials;
      return this.app.auth().signInWithCustomToken(customToken);
    }

    if ("idToken" in credentials && "providerId" in credentials) {
      const provider = new firebase.auth.OAuthProvider(
        credentials.providerId
      );
      const oAuthCredential = provider.credential(credentials.idToken);
      return this.app.auth().signInWithCredential(oAuthCredential);
    }

    if ("email" in credentials && "password" in credentials) {
      const { email, password } = credentials;
      return this.app
        .auth()
        .signInWithEmailAndPassword(email, password);
    }

    throw new Error(
      `Either {email,password}, {customToken}, or {idToken,providerId} is required`
    );
  }

  logout() {
    return this.app.auth().signOut();
  }

  public async createCustomToken(): Promise<CustomToken> {
    const [error, customToken] = await this.app
      .functions()
      .httpsCallable("createCustomToken")()
      .then(({ data }) => [null, data])
      .catch((error) => [error, null]);

    if (error) {
      return Promise.reject(error);
    }

    return customToken;
  }

  async getDevices() {
    const userId = this.user?.uid;

    if (!userId) {
      return Promise.reject(`Please login.`);
    }

    const snapshot = await this.app
      .database()
      .ref(this.getUserDevicesPath())
      .once("value");

    const userDevices: UserDevices | null = snapshot.val();

    return this.userDevicesToDeviceInfoList(userDevices);
  }

  async addDevice(deviceId: string): Promise<void> {
    const userId = this.user?.uid;

    if (!userId) {
      return Promise.reject(`Please login.`);
    }

    const [isValid, invalidErrorMessage] = await this.isDeviceIdValid(
      deviceId
    )
      .then((isValid) => [isValid])
      .catch((error) => [false, error]);

    if (!isValid) {
      return Promise.reject(invalidErrorMessage);
    }

    const claimedByPath = this.getDeviceClaimedByPath(deviceId);
    const userDevicePath = this.getUserClaimedDevicePath(deviceId);

    const [hasError, errorMessage] = await this.app
      .database()
      .ref()
      .update({
        [claimedByPath]: userId,
        [userDevicePath]: {
          claimedOn: SERVER_TIMESTAMP
        }
      })
      .then(() => [false])
      .catch((error) => [true, error]);

    if (hasError) {
      return Promise.reject(errorMessage);
    }
  }

  async removeDevice(deviceId: string): Promise<void> {
    const userId = this.user?.uid;

    if (!userId) {
      return Promise.reject(`Please login.`);
    }

    const claimedByPath = this.getDeviceClaimedByPath(deviceId);
    const userDevicePath = this.getUserClaimedDevicePath(deviceId);

    const claimedByRef = this.app.database().ref(claimedByPath);
    const userDeviceRef = this.app.database().ref(userDevicePath);

    const [hasError, errorMessage] = await Promise.all([
      claimedByRef.remove(),
      userDeviceRef.remove()
    ])
      .then(() => [false])
      .catch((error) => [true, error]);

    if (hasError) {
      return Promise.reject(errorMessage);
    }
  }

  async isDeviceIdValid(deviceId: string): Promise<boolean> {
    // hex string of 32 characters
    const hexRegEx = /[0-9A-Fa-f]{32}/g;
    if (
      !deviceId ||
      deviceId.length !== 32 ||
      !hexRegEx.test(deviceId)
    ) {
      return Promise.reject("The device id is incorrectly formatted.");
    }

    const claimedByPath = this.getDeviceClaimedByPath(deviceId);
    const claimedByRef = this.app.database().ref(claimedByPath);

    const claimedBySnapshot = await claimedByRef
      .once("value")
      .catch(() => null);

    if (!claimedBySnapshot || claimedBySnapshot.exists()) {
      return Promise.reject("The device has already been claimed.");
    }

    return true;
  }

  onUserDevicesChange(): Observable<DeviceInfo[]> {
    return this.onAuthStateChanged().pipe(
      switchMap((user) => {
        if (!user) {
          return empty();
        }

        const userDevicesPath = this.getUserDevicesPath();
        const userDevicesRef = this.app.database().ref(userDevicesPath);

        return fromEventPattern(
          (handler) => userDevicesRef.on("value", handler),
          (handler) => userDevicesRef.off("value", handler)
        ).pipe(
          map((snapshot: firebase.database.DataSnapshot) =>
            snapshot.val()
          ),
          switchMap((userDevices: UserDevices | null) => {
            return from(this.userDevicesToDeviceInfoList(userDevices));
          })
        );
      })
    );
  }

  private async userDevicesToDeviceInfoList(
    userDevices: UserDevices | null
  ): Promise<DeviceInfo[]> {
    const devicesInfoSnapshots = Object.keys(
      userDevices ?? {}
    ).map((deviceId) =>
      this.app
        .database()
        .ref(this.getDeviceInfoPath(deviceId))
        .once("value")
    );

    const devicesList: DeviceInfo[] = await Promise.all(
      devicesInfoSnapshots
    ).then((snapshots) => snapshots.map((snapshot) => snapshot.val()));

    const validDevices = devicesList.filter((device) => !!device);

    validDevices.sort((a, b) => {
      return (
        userDevices[a.deviceId].claimedOn -
        userDevices[b.deviceId].claimedOn
      );
    });

    return validDevices;
  }

  public async hasDevicePermission(deviceId: string): Promise<boolean> {
    const deviceInfoPath = this.getDeviceInfoPath(deviceId);

    const hasPermission = await this.app
      .database()
      .ref(deviceInfoPath)
      .once("value")
      .then(() => true)
      .catch(() => false);

    return hasPermission;
  }

  private getDeviceClaimedByPath(deviceId: string): string {
    return `devices/${deviceId}/status/claimedBy`;
  }

  private getUserClaimedDevicePath(deviceId: string): string {
    const userId = this.user.uid;
    return `users/${userId}/devices/${deviceId}`;
  }

  private getUserDevicesPath(): string {
    const userId = this.user.uid;
    return `users/${userId}/devices`;
  }

  private getDeviceInfoPath(deviceId: string): string {
    return `devices/${deviceId}/info`;
  }
}
