// Current weather from Open-Meteo (free, no key, CORS open), for the board header.
import { fetchJson } from './api'

const BASE = 'https://api.open-meteo.com/v1/forecast'

// Returns { temperature (°C), rainChance (% for the current hour, or null),
// code (WMO weather code), isDay, at }.
export async function fetchWeather(lat, lng) {
  const params = {
    latitude: lat,
    longitude: lng,
    current: 'temperature_2m,weather_code,is_day',
    hourly: 'precipitation_probability',
    timezone: 'Europe/Berlin',
    forecast_days: 1,
  }
  const data = await fetchJson(`${BASE}?${new URLSearchParams(params)}`, 'Open-Meteo')
  // Rain chance is only given per hour; take the hour the current reading belongs to.
  const hour = data.current.time.slice(0, 13)
  const i = data.hourly.time.findIndex((t) => t.startsWith(hour))
  return {
    temperature: data.current.temperature_2m,
    rainChance: i < 0 ? null : data.hourly.precipitation_probability[i],
    code: data.current.weather_code,
    isDay: data.current.is_day === 1,
    at: Date.now(),
  }
}

// WMO weather code -> the icon and words for it. Codes: 0 clear; 1-2 mainly
// clear / partly cloudy; 3 overcast; 45, 48 fog; 51-57 drizzle; 61-67 rain;
// 71-77 snow; 80-82 showers; 85-86 snow showers; 95-99 thunderstorm.
export function describe(code, isDay) {
  if (code === 0) return { icon: isDay ? 'sun' : 'moon', label: 'Clear' }
  if (code <= 2) return { icon: isDay ? 'partly' : 'cloud', label: 'Partly cloudy' }
  if (code === 3) return { icon: 'cloud', label: 'Overcast' }
  if (code <= 48) return { icon: 'fog', label: 'Fog' }
  if (code <= 57) return { icon: 'drizzle', label: 'Drizzle' }
  if (code <= 67) return { icon: 'rain', label: 'Rain' }
  if (code <= 77) return { icon: 'snow', label: 'Snow' }
  if (code <= 82) return { icon: 'rain', label: 'Showers' }
  if (code <= 86) return { icon: 'snow', label: 'Snow showers' }
  return { icon: 'thunder', label: 'Thunderstorm' }
}

// Stroked line icons on a 24×24 grid.
export const ICONS = {
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  partly:
    'M10.5 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM7.5 1v1.5M2 7h1.5M3.6 3.1l1.1 1.1M12.4 3.1l-1.1 1.1M19 13h-1.1A6 6 0 1 0 11 21h8a4 4 0 0 0 0-8Z',
  cloud: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10Z',
  fog: 'M19 13H6a4 4 0 1 1 .5-7.96A6 6 0 0 1 18 7.5h1a2.75 2.75 0 0 1 0 5.5ZM4 17h16M6 21h12',
  drizzle: 'M8 19v2M8 13v2M16 19v2M16 13v2M12 21v2M12 15v2M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25',
  rain: 'M16 13v8M8 13v8M12 15v8M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25',
  snow: 'M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25M8 16h.01M8 20h.01M12 18h.01M12 22h.01M16 16h.01M16 20h.01',
  thunder: 'M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9M13 11l-4 6h6l-4 6',
}
