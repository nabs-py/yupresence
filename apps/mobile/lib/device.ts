import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const deviceStorageKey = "yupresence.device.id";

export async function getOrCreateDeviceId(): Promise<string> {
  const existingDeviceId = await SecureStore.getItemAsync(deviceStorageKey);
  if (existingDeviceId) {
    return existingDeviceId;
  }

  const deviceId = Crypto.randomUUID();
  await SecureStore.setItemAsync(deviceStorageKey, deviceId);
  return deviceId;
}
