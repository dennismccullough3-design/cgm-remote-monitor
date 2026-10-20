'use strict';

const axios = require('axios');

class PavlokPlugin {
  constructor() {
    this.enabled = process.env.PAVLOK_ENABLED === 'true';
    this.token = process.env.PAVLOK_TOKEN;

    // User Requirements
    this.lowThreshold = 100;
    this.highThreshold = 300;

    // Prevent constant notifications
    this.alertCooldown =
      parseInt(process.env.PAVLOK_ALERT_COOLDOWN || '300000', 10);

    this.lastAlert = 0;
  }

  async sendStimulus(type, value, reason) {
    if (!this.enabled) {
      console.log('Pavlok disabled');
      return;
    }

    if (!this.token) {
      console.error('PAVLOK_TOKEN missing');
      return;
    }

    try {
      await axios.post(
        'https://api.pavlok.com/api/v5/stimulus/send',
        {
          stimulus: {
            stimulusType: type,
            stimulusValue: value
          }
        },
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`[PAVLOK] ${reason}`);
    } catch (error) {
      console.error(
        '[PAVLOK ERROR]',
        error.response?.data || error.message
      );
    }
  }

  calculateZapStrength(sgv) {
    if (sgv < 55) return 100;
    if (sgv < 70) return 90;
    if (sgv < 80) return 80;
    if (sgv < 90) return 65;
    return 50;
  }

  async sendLowAlert(sgv) {
    const strength = this.calculateZapStrength(sgv);

    await this.sendStimulus(
      'zap',
      strength,
      `LOW BG ALERT SGV=${sgv}`
    );
  }

  async sendHighAlert(sgv) {
    await this.sendStimulus(
      'vibe',
      100,
      `HIGH BG VIBRATION SGV=${sgv}`
    );

    await new Promise(resolve => setTimeout(resolve, 1000));

    await this.sendStimulus(
      'beep',
      100,
      `HIGH BG BEEP SGV=${sgv}`
    );
  }

  async processGlucose(sgv) {
    const now = Date.now();

    if (now - this.lastAlert < this.alertCooldown) {
      return;
    }

    if (sgv < this.lowThreshold) {
      this.lastAlert = now;
      await this.sendLowAlert(sgv);
      return;
    }

    if (sgv >= this.highThreshold) {
      this.lastAlert = now;
      await this.sendHighAlert(sgv);
      return;
    }
  }
}

module.exports = new PavlokPlugin();
