import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { API_BASE_URL } from './config/apiBase.js'
import './index.css'

// Helps verify production API routing after deploy (visible once in console).
console.info('[evaalo] API_BASE_URL =', API_BASE_URL)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

