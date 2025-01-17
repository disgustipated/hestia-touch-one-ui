import Vue from 'vue'
import Vuex from 'vuex'
import mqtt from 'mqtt'
import debounce from 'just-debounce'

const host = MQTT_SERVER
const port = '9001'
const client  = mqtt.connect(`mqtt://${host}:${port}`, { keepalive: 60, connectTimeout: 60000 })

Vue.use(Vuex)

export default new Vuex.Store({
  plugins: [mqttClientPlugin],
  state: {
    comfortMode: true,
    currentHumidity: 0,
    currentPressure: '--',
    currentTemperature: 0,
    hysteresis: 0,
    modes: {
      // Some terminology clarification on mode states:
      // active: on, but not necessarily running
      // selected: mode currently visible on the ui, not necessarily active
      // running: the current relay state as reported by openhab
      heat: {
        active: false,
        boostEnabled: false,
        boostTimeRemaining: 0,
        running: false,
        // Target temperature
        setValue: 0,
        // How much to increment the target temperature with each tap
        stepSize: 0.5,
      },
      // 2nd-stage or emergency heating
      heat2: {
        running: false
      },
      cool: {
        active: false,
        boostEnabled: false,
        boostTimeRemaining: 0,
        running: false,
        setValue: 0,
        stepSize: 1
      },
      fan: {
        active: false,
        boostEnabled: false, // always false
        boostTimeRemaining: 0,
        running: false
      },
      hotwater: {
        active: false,
        boostEnabled: false,
        boostTimeRemaining: 0,
        running: false
      },
      humidity: {
        active: false,
        boostEnabled: false,
        boostTimeRemaining: 0,
        running: false,
        setValue: 50,
        stepSize: 1
      }
    },
    info: {
      wanip: '--',
      wlanip: '--',
      ssid: '--',
      wlaninfo: '--',
      wlanmac: '--',
      cputemp: '--',
      cpuload: '--',
      useddisk: '--',
      tempunit: '--',
      systemtype: '--',
      season: '--'
    },
    selectedMode: '',
    showInfoScreen: false,
    showControls: true,
    showCooling: false,
    showHeating: false,
    showFan: false,
    showHumidity: false,
    showHotWater: false
  },
  getters: {
    targetTemperature
  },
  mutations: {
    decrementTargetValue,
    incrementTargetValue,
    selectMode,
    selectPowerSetting,
    toggleInfoScreen,
    rebootSystemCommand
  }
})

function mqttClientPlugin(store) {
  store.client = client

  const messageCallbacks = {
    //
    // Mode-setting topics
    //
    'hestia/local/cmnd/coolingmode': updateMode(store.state, 'cool'),
    'hestia/local/cmnd/fanmode': updateMode(store.state, 'fan'),
    'hestia/local/cmnd/heatingmode': updateMode(store.state, 'heat'),
    'hestia/local/cmnd/hotwatermode': updateMode(store.state, 'hotwater'),
    'hestia/local/cmnd/humiditymode': updateMode(store.state, 'humidity'),
    //
    // Power-setting topics
    //
    'hestia/local/comfortmode': message => {
      store.state.comfortMode = message !== 'ECO'
    },
    'hestia/local/hysteresis': message => {
      store.state.hysteresis = Number(message)
    },
    'hestia/local/cmnd/coolingstate/POWER': message => {
      store.state.modes.cool.running = message === 'ON'
    },
    'hestia/local/cmnd/heatingstate/POWER': message => {
      store.state.modes.heat.running = message === 'ON'
    },
    'hestia/local/cmnd/heating2state/POWER': message => {
      store.state.modes.heat2.running = message === 'ON'
    },
    'hestia/local/cmnd/fanstate/POWER': message => {
      store.state.modes.fan.running = message === 'ON'
    },
    'hestia/local/cmnd/hotwaterstate/POWER': message => {
      store.state.modes.hotwater.running = message === 'ON'
    },
    'hestia/local/cmnd/humiditystate/POWER': message => {
      store.state.modes.humidity.running = message === 'ON'
    },
    //
    // Boost timer topics
    //
    'hestia/coolingboostremtime': message => {
      store.state.modes.cool.boostTimeRemaining = Number(message)
    },
    'hestia/heatingboostremtime': message => {
      store.state.modes.heat.boostTimeRemaining = Number(message)
    },
    'hestia/hotwaterboostremtime': message => {
      store.state.modes.hotwater.boostTimeRemaining = Number(message)
    },
    'hestia/humidityboostremtime': message => {
      store.state.modes.humidity.boostTimeRemaining = Number(message)
    },
    //
    // Status topics
    //
    'hestia/local/temperature': message => {
      if (store.state.info.tempunit === 'C') {
        store.state.currentTemperature = message
      } else {
        store.state.currentTemperature = parseInt(message)
      }
    },
    'hestia/local/maxtempsetpoint': message => {
      store.state.modes.cool.setValue = parseFloat(message)
    },
    'hestia/local/mintempsetpoint': message => {
      store.state.modes.heat.setValue = parseFloat(message)
    },
    'hestia/local/humidity': message => {
      store.state.currentHumidity = parseInt(message)
    },
    'hestia/local/humisetpoint': message => {
      store.state.modes.humidity.setValue = parseInt(message)
    },
    'hestia/local/pressure': message => {
      store.state.currentPressure = message
    },
    //
    // System topics
    //
    'hestia/local/wanip': message => {
      store.state.info.wanip = message
    },
    'hestia/local/wlanip': message => {
      store.state.info.wlanip = message
    },
    'hestia/local/ssid': message => {
      store.state.info.ssid = message
    },
    'hestia/local/wlaninfo': message => {
      store.state.info.wlaninfo = message
    },
    'hestia/local/wlanmac': message => {
      store.state.info.wlanmac = message
    },
    'hestia/local/cputemp': message => {
      store.state.info.cputemp = message
    },
    'hestia/local/cpuload': message => {
      store.state.info.cpuload = message
    },
    'hestia/local/useddisk': message => {
      store.state.info.useddisk = message
    },
    'hestia/local/tempunit': message => {
      store.state.info.tempunit = message
      if (message === 'C') {
        store.state.modes.heat.stepSize = 0.5
        store.state.modes.cool.stepSize = 0.5
      } else {
        store.state.modes.heat.stepSize = 1
        store.state.modes.cool.stepSize = 1
      }
    },
    'hestia/local/systemtype': message => {
      store.state.info.systemtype = message
      if (store.state.info.systemtype === 'US') {
        // Typical US/HVAC modes
        store.state.showHumidity = false
        store.state.showHotWater = false

        store.state.showFan = true
        store.state.showHeating = true
        store.state.showCooling = true
      } else {
        // Typical EU modes
        store.state.showFan = false
        store.state.showCooling = false

        store.state.showHeating = true
        store.state.showHumidity = true
        store.state.showHotWater = true
      }
    },
    'hestia/local/season': message => {
      store.state.info.season = message
      if (store.state.info.season === 'SUMMER') {
        if (store.state.info.systemtype === 'US') {
          store.state.showCooling = true
        }
        store.state.showHeating = true
      } else {
        if (store.state.info.systemtype === 'US') {
          store.state.showCooling = true
        } else {
          store.state.showCooling = false
        }
        store.state.showHeating = true
      }
    }
  }

  client.on('connect', () => {
    console.debug('WS connected to: '+host)
    client.subscribe(
      [
        // Comfort
        'hestia/local/comfortmode',
        'hestia/local/hysteresis',
        // Heating
        'hestia/local/cmnd/heatingmode',
        'hestia/local/cmnd/heatingstate/POWER',
        'hestia/local/cmnd/heating2state/POWER',
        'hestia/local/mintempsetpoint',
        // Cooling
        'hestia/local/cmnd/coolingmode',
        'hestia/local/cmnd/coolingstate/POWER',
        'hestia/local/maxtempsetpoint',
        // Fan
        'hestia/local/cmnd/fanmode',
        'hestia/local/cmnd/fanstate/POWER',
        // Hot water
        'hestia/local/cmnd/hotwatermode',
        'hestia/local/cmnd/hotwaterstate/POWER',
        // Humidity
        'hestia/local/cmnd/humiditymode',
        'hestia/local/cmnd/humiditystate/POWER',
        // Sensor metrics
        'hestia/local/temperature',
        'hestia/local/humidity',
        'hestia/local/humisetpoint',
        //'hestia/local/pressure', // Currently unused
        // System settings
        'hestia/local/wanip',
        'hestia/local/wlanip',
        'hestia/local/ssid',
        'hestia/local/wlaninfo',
        'hestia/local/wlanmac',
        'hestia/local/cputemp',
        'hestia/local/cpuload',
        'hestia/local/useddisk',
        // Unit settings
        'hestia/local/tempunit',
        'hestia/local/systemtype',
        'hestia/local/season',
        // Boost mode timers
        'hestia/heatingboostremtime',
        'hestia/coolingboostremtime',
        'hestia/humidityboostremtime',
        'hestia/hotwaterboostremtime'
      ],
      (error) => {
        if (error) {
          throw new Error(error)
        }
      }
    )
  })

  client.on('reconnect', () => {
    console.debug(`Reconnecting to ${host}...`)
  })

  client.on('disconnect', () => {
    console.debug(`Disonnected from ${host}`)
  })

  client.on('message', function(topic, message, packet) {
    // Message is Buffer
    const parsedMessage = message.toString()
    console.debug(`[receiving] ${topic}: ${parsedMessage}`)

    if (!messageCallbacks[topic]) {
      throw new Error(`Unhandled topic received ${topic}`)
    }

    messageCallbacks[topic](parsedMessage, packet)
  })

}

///
/// Getters
///

function targetTemperature(state) {
  if (state.selectedMode === '') {
    state.showControls = false
  } else if (state.selectedMode === 'fan') {
    state.showControls = false
    return 'Fan'
  } else if (state.selectedMode === 'hotwater') {
    state.showControls = false
    return 'Hot Water'
  } else {
    state.showControls = true
  }
  const modeState = state.modes[state.selectedMode]
  if (modeState) {
    if (state.selectedMode == 'humidity') {
      return `${modeState.setValue}<span class="symbol">%</span>`
    } else { //temperature
      return `${modeState.setValue}<span class="symbol">&deg;</span>`
    }
  }
  return 'Off'
}

//
// Mutations
//

// Publish the data we just stored in the UI's display. This functionality is
// wrapped in a debounce to prevent sending the server too many messages. For
// instance changing the humidity setpoint from 51 to 52 to 53 to 54... by tapping
// the screen multiple times the server will only receive the final message
// that the new humidity setpoint is 54 and none of the in-between settings.
const publishTargetValue = debounce((state, mode, value) => {
  const topics = {
    cool: 'hestia/local/cmnd/setmaxtempsetpoint',
    heat: 'hestia/local/cmnd/setmintempsetpoint',
    humidity: 'hestia/local/sethumisetpoint'
  }

  console.debug(`[sending] ${topics[mode]}: ${value}`)
  client.publish(topics[mode], value.toString())
}, 1600)

function decrementTargetValue(state) {
  const modeState = state.modes[state.selectedMode]
  // Applies to heat, cool, and humidity
  if (modeState.setValue !== undefined) {
    modeState.setValue -= modeState.stepSize
    publishTargetValue(state, state.selectedMode, modeState.setValue)
  }
}

function incrementTargetValue(state) {
  const modeState = state.modes[state.selectedMode]
  // Applies to heat, cool, and humidity
  if (modeState.setValue !== undefined) {
    modeState.setValue += modeState.stepSize
    publishTargetValue(state, state.selectedMode, modeState.setValue)
  }
}

// Highlight a mode on the screen which will in turn change the UI color
// mode (string) - 'heat', 'cool', 'humidity', 'hotwater', 'fan', ''
function selectMode(state, mode) {
  state.selectedMode = mode
}

// Report to openHAB what mode we selected and what option we want for it
// mode (string) - 'heat', 'cool', 'humidity', 'hotwater', 'fan'
// powerOption (string) - 'ON', 'OFF', 'AUTO', 'Boost'
function selectPowerSetting(state, { mode, powerOption }) {
  const topics = {
    heat: 'hestia/local/stat/heatingmode',
    cool: 'hestia/local/stat/coolingmode',
    fan: 'hestia/local/stat/fanmode',
    hotwater: 'hestia/local/stat/hotwatermode',
    humidity: 'hestia/local/stat/humiditymode'
  }

  // We don't set a local state for this. Merely report to openhab
  // what we want and it will return all the power states for us.
  console.debug(`[sending] ${topics[mode]}: ${powerOption}`)
  client.publish(topics[mode], powerOption)

  // Ok I lied, let's eagerly update even though we're going to get an openhab response
  updateMode(state, mode)(powerOption)
}

function toggleInfoScreen(state) {
  state.showInfoScreen = !state.showInfoScreen
}

function rebootSystemCommand(){
  client.publish('hestia/local/cmnd/rebootsystem')
}

function updateMode(state, mode) {
  const modeState = state.modes[mode]
  return powerOption => {
    if (powerOption === 'ON') {
      // In case it's not already selected
      state.selectedMode = mode
      modeState.active = true
      modeState.boostEnabled = false
    } else if (powerOption === 'Boost') {
      state.selectedMode = mode
      modeState.active = true
      modeState.boostEnabled = true
    } else {
      modeState.active = false
      modeState.boostEnabled = false
    }
  }
}
