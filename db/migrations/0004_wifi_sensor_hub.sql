-- The Wi-Fi sensor hub (ESP32, firmware/sensor-hub-esp32) reports CO2 and sound activity instead of the
-- Uno's MQ-7, MQ-2 and KY-037 analog level (ADR 0002 §7). The old types stay for data already ingested.
INSERT INTO "sensor_types" ("key", "unit", "description") VALUES
  ('co2_ppm', 'ppm', 'CO2 concentration (MH-Z19C, NDIR)'),
  ('sound_active_pct', '%', 'Share of the second the sound level was above the KY-037 threshold (digital output), not dB')
ON CONFLICT ("key") DO NOTHING;
