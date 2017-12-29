'use strict'

const express = require('express');
const app = express();

const cryptolio = require('./cryptolio');

app.get('/', (req, res) => {
  cryptolio.getAllAccounts()
    .then((accounts) => {
      res.json(accounts);
    })
    .catch(err => {
      res.send(err);
    });
});

app.listen(3000, () => console.log('Example app listening on port 3000!'));
