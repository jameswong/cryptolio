'use strict'

const express = require('express')
const app = express()

const cryptolio = require('./cryptolio')

app.use(express.static('public'))

app.get('/api/accounts', (req, res) => {
  cryptolio.getAllAccounts()
    .then((accounts) => {
      res.json(accounts)
    })
    .catch(err => {
      console.log('error')
      res.send(err)
    })
})

app.get('/api/arbitrage', (req, res) => {
  cryptolio.arbitrage()
    .then((data) => {
      res.json(data)
    })
    .catch(err => {
      console.log('error')
      res.send(err)
    })
})

app.listen(3000, () => console.log('Example app listening on port 3000!'))
