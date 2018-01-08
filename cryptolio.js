'use strict'

const accounts = require('./accounts.json');

const Client = require('coinbase').Client;
const coinbase = new Client(accounts.coinbase);

coinbase.getAccountsAsync = function () {
  return new Promise((resolve, reject) => {
    coinbase.getAccounts({}, (err, accounts) => {
      if (err) {
        reject(err);
      } else {
        resolve (accounts);
      }
    });
  });
};
coinbase.getTransactionsAsync = function (account, type) {
  return new Promise((resolve, reject) => {
    account.getTransactions(null, (err, txns) => {
      if (err) {
        reject(err);
      } else {
        var filtered = txns.reduce((acc, cur) => {
          if (cur.type === type) {
            acc.push(cur);
          }
          return acc;
        }, []);
        resolve(filtered);
      }
    });
  });
};
coinbase.getBuysAsync = function (account) {
  return new Promise((resolve, reject) => {
    account.getBuys(null, (err, buys) => {
      if (err) {
        reject(err);
      } else {
        resolve(buys);
      }
    });
  });
};

const bittrex = require('node-bittrex-api');
bittrex.options({
  apikey: accounts.bittrex.apiKey,
  apisecret: accounts.bittrex.apiSecret,
  inverse_callback_arguments: true
});
bittrex.getbalancesAsync = function () {
  return new Promise((resolve, reject) => {
    bittrex.getbalances((err, accounts) => {
      if (err) {
        reject(err);
      } else {
        resolve(accounts);
      }
    });
  });
};
bittrex.getmarketsummariesAsync = function (symbol) {
  return new Promise((resolve, reject) => {
    bittrex.getmarketsummaries((err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};
bittrex.getorderhistoryAsync = function () {
  return new Promise((resolve, reject) => {
    bittrex.getorderhistory({}, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};

const AuthenticatedClient = require('gdax').AuthenticatedClient;
const gdax = new AuthenticatedClient(accounts.gdax.apiKey, accounts.gdax.apiSecret, accounts.gdax.passphrase);

const BinanceRest = require('binance').BinanceRest;
const binance = new BinanceRest({
  key: accounts.binance.apiKey,
  secret: accounts.binance.apiSecret
});

const XCoinApi = require('./bithumb').XCoinAPI;
const bithumb = new XCoinApi(accounts.bithumb);

const Kucoin = require('kucoin-api');
const kucoin = new Kucoin(accounts.kucoin.apiKey, accounts.kucoin.apiSecret);

function getKucoinAccount() {
  return kucoin.getBalance()
    .then(balance => {
      var tickers = [];
      var orders = [];
      var data = balance.data.reduce((acc, cur) => {
        if (cur.balance > 0) {
          acc.push({
            currency: cur.coinType,
            balance: cur.balance
          });
          if (cur.coinType !== 'BTC') {
            tickers.push(kucoin.getTicker({ pair: cur.coinType + '-BTC' }));
            orders.push(kucoin.getDealtOrders({ pair: cur.coinType + '-BTC', type: 'BUY' }));
          }
        }
        return acc;
      }, []);
      return Promise.all([
        data,
        Promise.all(tickers),
        Promise.all(orders)
      ]);
    })
    .then(data => {
      var [account, tickers, orders] = data;
      for (var i = 0; i < tickers.length; i++) {
        account[i].BTC = {
          price: tickers[i].data.lastDealPrice,
          average: orders[i].data.datas[0].dealPrice
        }
      }
      return account;
    })
}

function formatBittrex(accounts) {
  var result = [];
  accounts.result.forEach(account => {
    var balance = parseFloat(account.Balance);
    if (balance > 0) {
      result.push({
        currency: account.Currency,
        balance: balance
      })
    }
  });
  return result;
};

function formatBinance(accounts) {
  var result = [];
  accounts.balances.forEach(account => {
    var free = parseFloat(account.free);
    var locked = parseFloat(account.locked);
    if (free > 0 || locked > 0) {
      result.push({
        currency: account.asset,
        balance: free + locked
      });
    }
  });
  return result;
};

function getBinanceAccount() {
  return Promise.all([
    binance.account(),
    binance.allPrices(),
  ])
  .then(data => {
    var [account, prices] = data;
    account = formatBinance(account);
    prices = prices.reduce((acc, cur) => {
      if (cur.symbol.match(/BTC$/)) {
        acc[cur.symbol] = { price: parseFloat(cur.price) };
      }
      return acc;
    }, {});
    var requests = [account];
    account.forEach(item => {
      if (item.currency !== 'BTC') {
        requests.push(binance.myTrades(item.currency + 'BTC'));
        item.BTC = { price: prices[item.currency + 'BTC'].price }
      }
    });
    return Promise.all(requests);
  })
  .then(data => {
    var account = data.shift();
    for (var i = 0; i < data.length; i++) {
      account[i+1].BTC.average = getWeightedAverage(data[i], 'price', 'qty');
    }
    return account;
  })
}

function getBittrexAccount() {
  return Promise.all([
    bittrex.getbalancesAsync(),
    bittrex.getorderhistoryAsync(),
    bittrex.getmarketsummariesAsync()
  ])
  .then(data => {
    var [account, order, prices] = data;
    account = formatBittrex(account);
    order = order.result.reduce((acc, cur) => {
      if (!acc[cur.Exchange]) {
        acc[cur.Exchange] = [];
      }
      acc[cur.Exchange].push(cur);
      return acc;
    }, {});
    prices = prices.result.reduce((acc, cur) => {
      if (cur.MarketName.match(/^BTC/)) {
        var name = cur.MarketName.split('-')[1] + 'BTC';
        if (!acc[name] || (acc[name] && acc[name].price < cur.Last)) {
          acc[name] = { price: cur.Last };
        }
      }
      return acc;
    }, {});
    account.forEach(item => {
      if (item.currency !== 'BTC') {
        item.BTC = { price: prices[item.currency + 'BTC'].price };
        if (order['BTC-' + item.currency]) {
          item.BTC.average = getWeightedAverage(order['BTC-' + item.currency], 'PricePerUnit', 'Quantity');
        }
      }
    });
    return account;
  })
}

function getCoinbaseAccount() {
  function sortAccounts(accounts) {
    var order = ['USD', 'BTC', 'BCH', 'ETH', 'LTC'];
    return accounts.sort((a, b) => {
      var aIndex = order.indexOf(a.currency);
      var bIndex = order.indexOf(b.currency);
      return aIndex - bIndex;
    });
  }
  return Promise.all([
    coinbase.getAccountsAsync().then(sortAccounts),
    gdax.getAccounts().then(sortAccounts),
    gdax.getProductTicker('BTC-USD'),
    gdax.getProductTicker('BCH-USD'),
    gdax.getProductTicker('ETH-USD'),
    gdax.getProductTicker('LTC-USD')
  ])
  .then(accounts => {
    var [coinbaseAccounts, gdaxAccounts, btc, bch, eth, ltc] = accounts;
    var usdPrice = {
      BTC: btc,
      BCH: bch,
      ETH: eth,
      LTC: ltc
    };
    var requests = [accounts, usdPrice];
    for (let i = 1; i < coinbaseAccounts.length; i++) {
      requests.push(coinbase.getBuysAsync(coinbaseAccounts[i]));
    }
    requests.push(gdax.getFills());
    return Promise.all(requests);
  })
  .then(data => {
    var [accounts, usdPrice, btc, bch, eth, ltc, fills] = data;
    var orders = {};
    function normalize(buys) {
      return buys.map(function (buy) {
        return { price: parseFloat(buy.subtotal.amount), size: parseFloat(buy.amount.amount) };
      });
    };
    orders.BTC = normalize(btc);
    orders.BCH = normalize(bch);
    orders.ETH = normalize(eth);
    orders.LTC = normalize(ltc);
    fills.reduce((acc, cur) => {
      var name = cur.product_id.split('-')[0];
      if (!acc[name]) {
        acc[name] = [];
      }
      acc[name].push({
        price: parseFloat(cur.price),
        size: parseFloat(cur.size)
      });
      return acc;
    }, orders);
    var [coinbaseAccounts, gdaxAccounts] = accounts;
    var result = [];
    for (let i = 0; i < coinbaseAccounts.length; i++) {
      var item = {
        currency: coinbaseAccounts[i].currency,
        balance: parseFloat(coinbaseAccounts[i].balance.amount) + parseFloat(gdaxAccounts[i].balance),
      };
      if (usdPrice[item.currency]) {
        item.USD = { price: parseFloat(usdPrice[item.currency].price) };
        if (orders[item.currency]) {
          item.USD.average = getWeightedAverage(orders[item.currency]);
        }
      }
      result.push(item);
    }
    return result;
  })
}

function getWeightedAverage(trades, keyPrice = 'price', keyQuantity = 'size') {
  var { total, quantity } = trades.reduce((acc, cur) => {
    var price = cur[keyPrice];
    var qty = cur[keyQuantity];
    price = parseFloat(price);
    qty = parseFloat(qty);
    acc.total += price * qty;
    acc.quantity += qty;
    return acc;
  }, { total: 0, quantity: 0 });
  return total / quantity;
}

function getAllAccounts() {
  return Promise.all([
    getCoinbaseAccount(),
    getBittrexAccount(),
    getBinanceAccount(),
    bithumb.getAccount(),
    getKucoinAccount()
  ])
  .then(data => {
    var [coinbase, bittrex, binance, bithumb, kucoin] = data;
    var accounts = {
      coinbase: coinbase,
      bittrex: bittrex,
      binance: binance,
      bithumb: bithumb,
      kucoin: kucoin
    };
    var total = {
      value: {
        USD: 0,
        BTC: 0
      }
    };
    for (const name in accounts) {
      accounts[name].reduce((acc, cur) => {
        var currency = acc[cur.currency] || { balance: 0 };
        if (cur.currency === 'USD') {
          total.value.USD += cur.balance;
        }
        if (cur.currency === 'BTC') {
          total.value.BTC += cur.balance;
        }
        if (cur.USD) {
          currency.USD = Object.assign({}, cur.USD);
          currency.USD.source = name;
          total.value.USD += cur.balance * cur.USD.price;
          currency['usd-value'] = cur.balance * cur.USD.price;
        }
        if (cur.BTC) {
          total.value.BTC += cur.balance * cur.BTC.price;
          if (!currency.BTC) {
            currency.BTC = Object.assign({}, cur.BTC);
            currency.BTC.source = name;
            currency['btc-value'] = 0;
            currency['usd-value'] = 0;
          } else {
            if (cur.BTC.price > currency.BTC.price) {
              currency.BTC.price = cur.BTC.price;
              currency.BTC.source = name;
            }
            currency.BTC.average = ((cur.BTC.average * cur.balance) + (currency.BTC.average * currency.balance)) / (cur.balance + currency.balance);
          }
          currency['btc-value'] += cur.balance * cur.BTC.price;
          currency['usd-value'] = currency['btc-value'] * acc.BTC.USD.price;
          total.value.USD += currency['usd-value'];
        }
        if (cur.currency === 'BTC' && !cur.USD) {
          currency['usd-value'] += cur.balance * acc.BTC.USD.price;
          total.value.USD += cur.balance * acc.BTC.USD.price;
        }
        currency.balance += cur.balance;
        acc[cur.currency] = currency;
        return acc;
      }, total);
    }
    return {
      total: total,
      coinbase: coinbase,
      bittrex: bittrex,
      binance: binance,
      bithumb: bithumb,
      kucoin: kucoin
    };
  });
}

module.exports = {
  getAllAccounts: getAllAccounts
};
