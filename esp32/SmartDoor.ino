#include <WiFi.h>
#include <HTTPClient.h>
#include <esp_now.h>
#include <esp_wifi.h>

const char* ssid = "LK TRONICS-2.4G";
const char* password = "*********";

const char* serverUrl = "http://192.168.1.82:3034/door-event";

uint8_t buzzerMacAddress[] = {0x58, 0x2A, 0xBD, 0x77, 0x51, 0xEC};

typedef struct struct_message {
  char command[16];
} struct_message;

struct_message outgoingMessage;
bool espNowReady = false;
bool wifiEverConnected = false;
unsigned long lastWifiAttemptMs = 0;
unsigned long lastHttpAttemptMs = 0;
const unsigned long wifiReconnectIntervalMs = 10000;
const unsigned long httpRequestTimeoutMs = 2000;

const int pirSensorPin = 4;
const int ledPin = 2;

bool lastMotionDetected = false;
unsigned long lastSendMs = 0;
const unsigned long debounceMs = 250;

void startWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.println("Starting Wi-Fi connection attempt");
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
    Serial.print("Sender set ESP-NOW channel to ");
    Serial.println(wifiChannel);
  }
}

void onEspNowSent(const wifi_tx_info_t* txInfo, esp_now_send_status_t status) {
  (void)txInfo;
  Serial.print("ESP-NOW send status: ");
  Serial.println(status == ESP_NOW_SEND_SUCCESS ? "success" : "failed");
}

void setupEspNow() {
  if (WiFi.status() != WL_CONNECTED) {
    espNowReady = false;
    return;
  }

  configureEspNowChannel();

  esp_err_t initResult = esp_now_init();
  if (initResult != ESP_OK && initResult != ESP_ERR_ESPNOW_EXIST) {
    Serial.println("ESP-NOW init failed");
    espNowReady = false;
    return;
  }

  if (initResult == ESP_ERR_ESPNOW_EXIST) {
    Serial.println("ESP-NOW already initialized");
  }

  esp_now_register_send_cb(onEspNowSent);

  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, buzzerMacAddress, 6);
  peerInfo.channel = WiFi.channel();
  peerInfo.ifidx = WIFI_IF_STA;
  peerInfo.encrypt = false;

  if (esp_now_is_peer_exist(buzzerMacAddress)) {
    Serial.println("ESP-NOW peer already exists");
    espNowReady = true;
    return;
  }

  esp_err_t addPeerResult = esp_now_add_peer(&peerInfo);
  if (addPeerResult == ESP_OK) {
    espNowReady = true;
    Serial.print("ESP-NOW ready on channel ");
    Serial.println(WiFi.channel());
    return;
  }

  if (addPeerResult == ESP_ERR_ESPNOW_EXIST) {
    Serial.println("ESP-NOW peer already registered");
    espNowReady = true;
    return;
  }

  Serial.print("Failed to add ESP-NOW peer: ");
  Serial.println(addPeerResult);
  espNowReady = false;
}

void ensureEspNowReady() {
  if (WiFi.status() != WL_CONNECTED) {
    espNowReady = false;
    return;
  }

  if (!espNowReady) {
    setupEspNow();
  }
}

bool readMotionDetected() {
  return digitalRead(pirSensorPin) == HIGH;
}

bool postDoorEvent(const char* eventName) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("HTTP skipped: Wi-Fi not connected");
    return false;
  }

  if (lastHttpAttemptMs != 0 && millis() - lastHttpAttemptMs < 250) {
    return false;
  }
  lastHttpAttemptMs = millis();

  WiFiClient client;
  client.setTimeout(httpRequestTimeoutMs);

  HTTPClient http;
  if (!http.begin(client, serverUrl)) {
    Serial.println("HTTP begin failed");
    return false;
  }
  http.setTimeout(httpRequestTimeoutMs);
  http.setReuse(false);
  http.addHeader("Content-Type", "application/json");

  String payload = String("{\"event\":\"") + eventName + "\",\"time\":\"" + String(millis()) + "\"}";
  int statusCode = http.POST(payload);
  String response = (statusCode > 0) ? http.getString() : String();
  http.end();

  Serial.print("POST ");
  Serial.print(eventName);
  Serial.print(" -> ");
  Serial.println(statusCode);
  if (response.length() > 0) {
    Serial.println(response);
  }

  if (statusCode <= 0) {
    Serial.println("HTTP request failed");
    return false;
  }

  if (statusCode >= 400) {
    Serial.print("HTTP server error: ");
    Serial.println(statusCode);
    return false;
  }

  return true;
}

bool sendBuzzerSignal(const char* command) {
  if (!espNowReady) {
    ensureEspNowReady();
  }

  if (!espNowReady) {
    Serial.println("ESP-NOW not ready");
    return false;
  }

  memset(&outgoingMessage, 0, sizeof(outgoingMessage));
  strncpy(outgoingMessage.command, command, sizeof(outgoingMessage.command) - 1);

  esp_err_t result = esp_now_send(buzzerMacAddress, (uint8_t*)&outgoingMessage, sizeof(outgoingMessage));
  if (result == ESP_OK) {
    Serial.print("ESP-NOW command sent: ");
    Serial.println(command);
    return true;
  }

  Serial.print("ESP-NOW send error: ");
  Serial.println(result);
  return false;
}

void setup() {
  Serial.begin(115200);
  pinMode(pirSensorPin, INPUT);
  pinMode(ledPin, OUTPUT);
  digitalWrite(ledPin, LOW);

  lastSendMs = millis() - debounceMs;

  startWiFi();

  lastMotionDetected = readMotionDetected();
  if (lastMotionDetected) {
    Serial.println("Motion detected at startup");
    postDoorEvent("door_open");
    sendBuzzerSignal("BUZZER_ON");
    digitalWrite(ledPin, HIGH);
  }
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiEverConnected) {
      wifiEverConnected = true;
      Serial.print("Wi-Fi connected. IP: ");
      Serial.println(WiFi.localIP());
      Serial.print("Wi-Fi channel: ");
      Serial.println(WiFi.channel());
      espNowReady = false;
    }
  } else {
    if (wifiEverConnected) {
      Serial.println("Wi-Fi disconnected");
    }
    wifiEverConnected = false;
    espNowReady = false;
    if (millis() - lastWifiAttemptMs >= wifiReconnectIntervalMs) {
      startWiFi();
    }
  }

  ensureEspNowReady();

  bool motionDetected = readMotionDetected();
  unsigned long now = millis();

  if (motionDetected != lastMotionDetected && now - lastSendMs > debounceMs) {
    lastSendMs = now;
    lastMotionDetected = motionDetected;

    if (motionDetected) {
      Serial.println("Motion detected");
      digitalWrite(ledPin, HIGH);
      postDoorEvent("door_open");
      sendBuzzerSignal("BUZZER_ON");
    } else {
      Serial.println("Motion ended");
      digitalWrite(ledPin, LOW);
    }
  }

  delay(1);
}
