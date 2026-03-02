#include <WiFi.h>
#include "BluetoothSerial.h"

BluetoothSerial SerialBT;

// Scan settings
const int SCAN_DELAY = 2000; // 2 seconds between scans

void setup() {
  Serial.begin(115200);
  SerialBT.begin("ESP32_WIFI_SCANNER");

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  Serial.println("\n===============================");
  Serial.println(" ESP32 WiFi Scanner STARTED");
  Serial.println("===============================\n");

  delay(2000);
}

void loop() {
  Serial.println("\nScanning WiFi networks...");
  SerialBT.println("\n--- WIFI SCAN START ---");

  int n = WiFi.scanNetworks(false, true, false, 300); // 300 ms per channel
  if (n == 0) {
    Serial.println("No networks found");
    SerialBT.println("No networks found");
  } else {

    Serial.printf("Found %d networks\n\n", n);
    SerialBT.printf("Found %d networks\n", n);

    for (int i = 0; i < n; ++i) {

      String ssid = WiFi.SSID(i);
      if (ssid == "") ssid = "HIDDEN";

      String mac  = WiFi.BSSIDstr(i);
      int rssi    = WiFi.RSSI(i);
      int channel = WiFi.channel(i);
      bool enc    = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;

      // Print to Serial
      Serial.printf(
        "%2d | RSSI:%4d | CH:%2d | %s | %s | %s\n",
        i + 1,
        rssi,
        channel,
        enc ? "ENC" : "OPEN",
        ssid.c_str(),
        mac.c_str()
      );

      // Send via Bluetooth
      SerialBT.printf(
        "%s,%s,%d,%d,%s\n",
        ssid.c_str(),
        mac.c_str(),
        rssi,
        channel,
        enc ? "ENC" : "OPEN"
      );
    }
  }

  Serial.println("\nScan complete.");
  SerialBT.println("--- WIFI SCAN END ---");

  WiFi.scanDelete(); // free memory
  delay(SCAN_DELAY);
}