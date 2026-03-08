#include <WiFi.h>
#include "BluetoothSerial.h"

BluetoothSerial SerialBT;

// Scan settings
const int SCAN_DELAY = 2000;   // 2 seconds between scans
const int SCAN_TIME  = 300;    // 300 ms per channel

unsigned long scanID = 0;

void setup() {
  Serial.begin(115200);
  SerialBT.begin("ESP32_WIFI_SCANNER");

  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true); // disconnect and erase old connections
  delay(1000);

  Serial.println("ESP32 WiFi Scanner Ready");
}

void loop() {
  scanID++;

  // Perform WiFi scan
  int n = WiFi.scanNetworks(false, true, false, SCAN_TIME);

  if (n > 0) {
    // Optional timestamp or millis
    unsigned long timestamp = millis();  

    String scanLine = String(scanID) + "|" + String(timestamp) + "|";

    for (int i = 0; i < n; ++i) {
      String ssid = WiFi.SSID(i);
      if (ssid == "") ssid = "HIDDEN";

      String mac = WiFi.BSSIDstr(i);
      int rssi = WiFi.RSSI(i);

      String entry = ssid + "," + mac + "," + String(rssi);

      if (i > 0) scanLine += ";";  // separate networks with ;
      scanLine += entry;
    }

    // Send full line via Bluetooth
    SerialBT.println(scanLine);

    // Optional debug
    Serial.println(scanLine);
  }

  WiFi.scanDelete();   // free memory
  delay(SCAN_DELAY);
}