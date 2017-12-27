require('es6-promise').polyfill()
require('isomorphic-fetch')

const API_PATH = 'https://www.cryptocompare.com/api/data'
const MIN_API_PATH = 'https://min-api.cryptocompare.com/data'

const MS_IN_A_SEC = 1000
const MS_IN_A_MIN = MS_IN_A_SEC * 60
const MS_IN_A_HOUR = MS_IN_A_MIN * 60
const MS_IN_A_DAY = MS_IN_A_HOUR * 24
const MS_IN_A_WEEK = MS_IN_A_DAY * 7
const MS_IN_A_MONTH = MS_IN_A_DAY * 30
const MS_IN_A_YEAR = MS_IN_A_DAY * 365

const BASE_FIAT_CURRENCY = 'AUD'

const MIN_RUN_DAILY_CHANGE = 15

// Smaller list for faster testing
let COIN_CODES = ['KMD']

// If you want to wait ages then you can uncomment this :P
/*let COIN_CODES = [
  'BTC', 'ETC', 'BCH', 'XRP', 'LTC', 'IOT', 'ADA', 'DASH', 'XEM', 'BTG',
  'XMR', 'EOS', 'NEO', 'QTUM', 'XLM', 'ETC', 'LSK', 'XVG', 'ZEC', 'OMG',
  'BTS', 'WAVES', 'ARDR', 'USDT', 'NXT', 'STRAT', 'REP', 'BCN', 'STEEM', 'KMD',
  'ARK', 'DOGE', 'SC', 'DCR', 'GNT', 'DGB', 'PIVX', 'SALT', 'GBYTE', 'POWR',
  'WTC', 'FCT', 'PAY', 'BAT', 'KNC', 'VTC', 'MAID', 'RDD', 'GAS', 'ZRX',
  'XZC', 'CVC', 'GAME', 'FUN', 'NXS', 'BQX', 'RDN', 'MCO', 'MTL', 'PPC',
  'ADX', 'ENG', 'LBC', 'RISE', 'SAFEX'
]*/
let COINS = {}
let COIN_LIST = []

async function get(path, min, params) {
  const query = params && Object.keys(params).map(key => `${key}=${params[key]}`).join('&')
  const start = Date.now()
  const uri = `${min ? MIN_API_PATH : API_PATH}${path}${query ? `?${query}` : ''}`
  //console.info(uri)
  const res = await fetch(uri)
  const data = await res.json()
  //console.info(`${Date.now() - start}ms`)
  return data
}

async function init() {
  clearConsole()
  console.info('Loading coin list...')
  const data = await get('/coinlist')

  COIN_CODES.forEach(code => {
    const coin = data.Data[code]
    if (!coin) {
      console.error(`CANNOT FIND '${code}'`)
      return
    }
    COINS[code] = {
      id: coin.Id,
      code: coin.Symbol,
      name: coin.Name,
      title: coin.CoinName,
      supply: parseInt(coin.TotalCoinSupply) || undefined,
      prices: []
    }
  })
  COIN_CODES = Object.keys(COINS)
  COIN_LIST = COIN_CODES.map(c => COINS[c])
  
  clearConsole()
  console.info('Loading prices...')
  await getAllHistoricalPrices()
}

async function getAllHistoricalPrices() {
  // Need to avoid overloading crypto compare by only requesting a few at a time
  const maxConcurrentRequests = 5
  for (let i=0; i<COIN_CODES.length; i+=maxConcurrentRequests) {
    console.info(`${i} / ${COIN_CODES.length}`)
    const requests = []
    for (let j=0; j<maxConcurrentRequests && i + j <COIN_CODES.length; j++) {
      requests.push(getHistoricalPrices(COIN_CODES[i + j]))
    }
    await Promise.all(requests)
  }
}

async function getHistoricalPrices(code) {
  const data = await Promise.all([
    // Get minute to minute prices for the last day
    get('/histominute', true, { fsym: BASE_FIAT_CURRENCY, tsym: code, limit: 60 * 24 }),
    // Get hourly prices for the last 2 months
    get('/histohour', true, { fsym: BASE_FIAT_CURRENCY, tsym: code, limit: 24 * 30 * 2 }),
    // Get daily prices for the last 5 years
    get('/histoday', true, { fsym: BASE_FIAT_CURRENCY, tsym: code, limit: 5 * 365 })
  ])
  data.forEach(({Data}) => addEntries(code, Data))
  COINS[code].prices.sort((a, b) => a.time > b.time ? 1 : a.time < b.time ? -1 : 0)
}

function addEntries(code, entries) {
  if (!entries.length) console.error(`Error loading entries for '${code}'`)
  entries.forEach(entry => {
    if (!entry.close) return
    COINS[code].prices.push({
      time: entry.time * 1000,
      value: 1 / entry.close
    })
  })
}

async function getCurrentPrices() {
  const data = await get('/price', true, { fsym: BASE_FIAT_CURRENCY, tsyms: COIN_CODES.join(',') })
  COIN_CODES.forEach(code => {
    COINS[code].prices.push({
      time: Date.now(),
      value: 1 / data[code]
    })
    getMetrics(code)
    getRuns(code)
  })
}

function getMetrics(code) {
  const coin = COINS[code]
  const now = Date.now()
  coin.metrics = {
    hour: getPriceRangeMetrics(getPriceRange(code, now - MS_IN_A_HOUR, now)),
    day: getPriceRangeMetrics(getPriceRange(code, now - MS_IN_A_DAY, now)),
    week: getPriceRangeMetrics(getPriceRange(code, now - MS_IN_A_WEEK, now)),
    month: getPriceRangeMetrics(getPriceRange(code, now - MS_IN_A_MONTH, now)),
    year: getPriceRangeMetrics(getPriceRange(code, now - MS_IN_A_YEAR, now)),
    all: getPriceRangeMetrics(coin.prices)
  }
}

function getPriceRange(code, from, to) {
  return COINS[code].prices.filter(price => price.time >= from && price.time <= to)
}

function getPriceRangeMetrics(prices) {
  const metrics = {
    open: prices[0],
    close: prices[prices.length - 1],
    high: prices.reduce((high, price) => {
      return high && high.value > price.value ? high : price
    }),
    low: prices.reduce((low, price) => {
      return low && low.value < price.value ? low : price
    })
  }
  const delta = {}
  for (let fieldA in metrics) {
    for (let fieldB in metrics) {
      if (fieldA === fieldB) continue
      delta[`${fieldA}_${fieldB}`] = getPercentChange(metrics[fieldA].value, metrics[fieldB].value)
    }
  }
  metrics.delta = delta
  return metrics
}

function getPercentChange(toValue, fromValue) {
  return Math.round(toValue / fromValue * 100 - 100);
}

function getRuns(code) {
  const coin = COINS[code]
  // List of percent changes over every day
  const deltas = []
  let time = coin.prices[0].time
  const now = Date.now()
  while (time < now) {
    const fromTime = time
    const toTime = time + MS_IN_A_WEEK
    deltas.push({
      fromTime,
      toTime,
      change: getPercentChange(getPriceValueAtTime(code, toTime), getPriceValueAtTime(code, fromTime))
    })
    time += MS_IN_A_DAY
  }
  const filteredDeltas = deltas.filter(delta => delta.change > MIN_RUN_DAILY_CHANGE)
  // collapse the deltas
  for (let i = filteredDeltas.length - 2; i >= 0; i--) {
    if (filteredDeltas[i].toTime >= filteredDeltas[i + 1].fromTime) {
      filteredDeltas[i].toTime = filteredDeltas[i + 1].toTime
      filteredDeltas.splice(i + 1, 1)
    }
  }
  coin.runs = filteredDeltas.map(delta => {
    const metrics = getPriceRangeMetrics(getPriceRange(code, delta.fromTime, delta.toTime))
    return {
      from: metrics.low,
      to: metrics.high
    }
  })
}

function getPriceValueAtTime(code, time) {
  const prices = COINS[code].prices
  const firstPrice = prices[0]
  const lastPrice = prices[prices.length - 1]
  if (time <= firstPrice.time) return firstPrice.value
  if (time >= lastPrice.time) return lastPrice.value
  // TODO - optimise with a binary search
  for (let i = 0; i < prices.length - 1; i++) {
    const from = prices[i]
    const to = prices[i + 1]
    if (from.time === to.time) continue
    if (time >= from.time && time <= to.time) {
      const deltaValue = to.value - from.value
      const deltaTime = to.time - from.time
      return from.value + (time - from.time) / deltaTime * deltaValue
    }
  }
  return 0
}

function logCoin(code) {
  const coin = COINS[code]
  console.info(`
    ${coin.title} (${coin.code})
    ${metricRangeToString(code, 'day')}
    ${metricRangeToString(code, 'week')}
    ${metricRangeToString(code, 'month')}
    ${metricRangeToString(code, 'year')}
    ${metricRangeToString(code, 'all')}
    RUNS (${coin.runs.length})
    ${coin.runs.reverse().slice(0, 2).map(runToString).join()}
  `)
}

function metricRangeToStringShort(code, metricRange) {
  const metrics = COINS[code].metrics[metricRange]
  return `
    ${code} - ${timeToString(metrics.open.time)}
    ----------------------------------------------------------------
    open:          | ${priceToString(metrics.open)}
    close:         | ${priceToString(metrics.close)}
    high:          | ${priceToString(metrics.high, true)}
    low:           | ${priceToString(metrics.low, true)}
    open -> close: | ${negPos(metrics.delta.close_open)}%
  `
}

function metricRangeToString(code, metricRange) {
  const metrics = COINS[code].metrics[metricRange]
  return `
    ${metricRange.toUpperCase()} - ${timeToString(metrics.open.time)} to ${timeToString(metrics.close.time)}
    ----------------------------------------------------------------
    open:          | ${priceToString(metrics.open)}
    close:         | ${priceToString(metrics.close)}
    high:          | ${priceToString(metrics.high, true)}
    low:           | ${priceToString(metrics.low, true)}
    open -> close: | ${negPos(metrics.delta.close_open)}%
    high -> close: | ${negPos(metrics.delta.close_high)}%
    low -> close:  | ${negPos(metrics.delta.close_low)}%
    low -> high:   | ${negPos(metrics.delta.high_low)}%
  `
}

function runToString(run) {
  return `
    ----------------------------------------------------------------
    ${Math.floor((Date.now() - run.to.time) / MS_IN_A_DAY)} days ago
    from:          | ${priceToString(run.from, true)}
    to:            | ${priceToString(run.to, true)}
    change:        | ${negPos(getPercentChange(run.to.value, run.from.value))}%
  `
}

function priceToString(price, renderTime) {
  return `${formatValue(price.value)}${renderTime ? ` - ${timeToString(price.time)}` : ''}`
}

function formatValue(value) {
  const dp = Math.max(0, 3 - Math.floor(Math.log10(value)))
  return value.toFixed(dp)
}

function timeToString(time) {
  if (Math.abs(Date.now() - time) < MS_IN_A_SEC * 5) return 'NOW'
  return new Date(time).toLocaleTimeString('en-us', {
    year: 'numeric',
    month: 'short',  
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'  
  })
}

function negPos(value) {
  return value > 0 ? '+' + value : value;
}

function clearConsole() {
  console.info('\x1Bc')
}

async function wait(time) {
  return await new Promise((resolve, reject) => {
    setTimeout(resolve, time)
  })
}

function isInteresting(code) {
  const coin = COINS[code]
  const lastRun = !!coin.runs.length && coin.runs[coin.runs.length - 1]
  return !lastRun || (
    /* a run going within the last day */
    Math.abs(Date.now() - lastRun.to.time) < MS_IN_A_DAY &&
    /* had had 10% gain in the last day */
    coin.metrics.day.delta.close_open > 10 &&
    /* not had had 5% loss in the last hour */
    coin.metrics.hour.delta.close_open > -5
  )
}

function calculatePercentGain() {
  const owned = {}
  let percentGain = 0
  transactions.forEach(transaction => {
    if (transaction.type === 'buy') {
      owned[transaction.code] = transaction
    } else {
      percentGain += transaction.price / owned[transaction.code].price - 1
      delete owned[transaction.code]
    }
  })
  Object.keys(owned).forEach(code => {
    const transaction = owned[code]
    const prices = COINS[code].prices
    percentGain += prices[prices.length - 1].value / transaction.price - 1
  })
  return percentGain * 100
}

let prevInteresting = []
let transactions = []
async function start() {
  await init()

  clearConsole()

  /*while (true) {
    await getCurrentPrices()

    const newInteresting = COIN_CODES.filter(isInteresting)
    const newList = newInteresting.join(', ')
    const prevList = prevInteresting.join(', ')
    if (newList !== prevList) {

      const buy = newInteresting.filter(code => !prevInteresting.includes(code))
      buy.forEach(code => {
        const prices = COINS[code].prices
        transactions.push({
          type: 'buy',
          code,
          price: prices[prices.length - 1].value
        })
      })
      
      const sell = prevInteresting.filter(code => !newInteresting.includes(code))
      sell.forEach(code => {
        const prices = COINS[code].prices
        transactions.push({
          type: 'sell',
          code,
          price: prices[prices.length - 1].value
        })
      })
      
      clearConsole()
      console.info(newList)
      console.info(`OWNED: ${newList}`)
      console.info(`BUY:   ${buy.join(', ')}`)
      console.info(`SELL:  ${sell.join(', ')}`)
      console.info(`GAIN:  ${negPos(calculatePercentGain())}%`)
      newInteresting.forEach(logCoin)
    }
    prevInteresting = newInteresting

    await wait(MS_IN_A_SEC * 15)
  }*/


  // UN-COMMENT TO LOG ALL COINS SORTED BY GAIN OVER THE LAST WEEK
  /*await getCurrentPrices()

  const sorted = COIN_CODES.sort((code1, code2) => {
    const v1 = COINS[code1].metrics.week.delta.open_close
    const v2 = COINS[code2].metrics.week.delta.open_close
    return v1 < v2 ? 1 : v1 > v2 ? -1 : 0
  })

  sorted.forEach(code => console.log(metricRangeToStringShort(code, 'week')))*/


  // JUST LOGGING ALL COINS
  await getCurrentPrices()
  COIN_CODES.forEach(logCoin)
}

start()
