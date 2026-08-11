#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

const char* ssid = "LK TRONICS-2.4G";
const char* password = "lktronics@2025";

const int buzzerPin = 5;

typedef struct struct_message {
  char command[16];
} struct_message;

struct_message incomingMessage;
bool wifiEverConnected = false;
bool espNowReady = false;
unsigned long lastWifiAttemptMs = 0;
unsigned long buzzerOffAt = 0;
const unsigned long buzzerDurationMs = 1000;
const unsigned long wifiReconnectIntervalMs = 10000;

void startWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.println("Receiver: starting Wi-Fi connection attempt");
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, password);
  lastWifiAttemptMs = millis();
}

void configureEspNowChannel() {
  uint8_t wifiChannel = WiFi.channel();
  if (wifiChannel == 0) {
    Serial.println("ESP-NOW channel setup skipped: Wi-Fi channel unavailable");
    return;
  }

  esp_wifi_set_promiscuous(true);
  esp_err_t channelResult = esp_wifi_set_channel(wifiChannel, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  if (channelResult != ESP_OK) {
    Serial.print("ESP-NOW channel setup failed: ");
    Serial.println(channelResult);
  } else {
    Serial.print("Receiver set ESP-NOW channel to ");
    Serial.println(wifiChannel);
  }
}

void activateBuzzer() {
  digitalWrite(buzzerPin, HIGH);
  buzzerOffAt = millis() + buzzerDurationMs;
  Serial.println("Buzzer ON");
}

void onDataRecv(const esp_now_recv_info_t* recvInfo, const uint8_t* incomingData, int len) {
  (void)recvInfo;

  memset(&incomingMessage, 0, sizeof(incomingMessage));
  size_t copyLength = len < (int)sizeof(incomingMessage) ? len : sizeof(incomingMessage);
  memcpy(&incomingMessage, incomingData, copyLength);

  Serial.print("ESP-NOW received: ");
  Serial.println(incomingMessage.command);

  if (strcmp(incomingMessage.command, "BUZZER_ON") == 0) {
    activateBuzzer();
  }
}

void setupEspNow() {
  if (WiFi.status() != WL_CONNECTED) {
    espNowReady = false;
    return;
  }

  configureEspNowChannel();

  esp_err_t initResult = esp_now_init();
  if (initResult != ESP_OK && initResult != ESP_ERR_ESPNOW_EXIST) {
    Serial.print("ESP-NOW init failed: ");
    Serial.println(initResult);
    espNowReady = false;
    return;
  }

  if (initResult == ESP_ERR_ESPNOW_EXIST) {
    Serial.println("ESP-NOW already initialized");
  }

  esp_now_register_recv_cb(onDataRecv);
  espNowReady = true;
  Serial.print("ESP-NOW receiver ready on channel ");
  Serial.println(WiFi.channel());
}

void setup() {
  Serial.begin(115200);
  pinMode(buzzerPin, OUTPUT);
  digitalWrite(buzzerPin, LOW);

  startWiFi();
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiEverConnected) {
      wifiEverConnected = true;
      Serial.print("Receiver Wi-Fi connected. IP: ");
      Serial.println(WiFi.localIP());
      Serial.print("Receiver Wi-Fi channel: ");
      Serial.println(WiFi.channel());
      espNowReady = false;
    }
  } else {
    if (wifiEverConnected) {
      Serial.println("Receiver Wi-Fi disconnected");
    }
    wifiEverConnected = false;
    espNowReady = false;

    if (millis() - lastWifiAttemptMs >= wifiReconnectIntervalMs) {
      startWiFi();
    }
  }

  if (WiFi.status() == WL_CONNECTED && !espNowReady) {
    setupEspNow();
  }

  if (buzzerOffAt != 0 && millis() > buzzerOffAt) {
    digitalWrite(buzzerPin, LOW);
    buzzerOffAt = 0;
    Serial.println("Buzzer OFF");
  }

  delay(1);
}