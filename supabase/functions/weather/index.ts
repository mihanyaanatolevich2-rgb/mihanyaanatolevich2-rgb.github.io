const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type WeatherResult = {
  temp: number;
  description: string;
  icon: string;
  city: string;
};

const RU_CITY_COORDS: Record<string, { name: string; latitude: number; longitude: number }> = {
  "москва": { name: "Москва", latitude: 55.7558, longitude: 37.6173 },
  "moscow": { name: "Москва", latitude: 55.7558, longitude: 37.6173 },
  "санкт-петербург": { name: "Санкт-Петербург", latitude: 59.9343, longitude: 30.3351 },
  "спб": { name: "Санкт-Петербург", latitude: 59.9343, longitude: 30.3351 },
  "новосибирск": { name: "Новосибирск", latitude: 55.0084, longitude: 82.9357 },
  "екатеринбург": { name: "Екатеринбург", latitude: 56.8389, longitude: 60.6057 },
  "казань": { name: "Казань", latitude: 55.7961, longitude: 49.1064 },
  "нижний новгород": { name: "Нижний Новгород", latitude: 56.2965, longitude: 43.9361 },
  "челябинск": { name: "Челябинск", latitude: 55.1644, longitude: 61.4368 },
  "самара": { name: "Самара", latitude: 53.1959, longitude: 50.1008 },
  "омск": { name: "Омск", latitude: 54.9885, longitude: 73.3242 },
  "ростов-на-дону": { name: "Ростов-на-Дону", latitude: 47.2357, longitude: 39.7015 },
  "уфа": { name: "Уфа", latitude: 54.7388, longitude: 55.9721 },
  "красноярск": { name: "Красноярск", latitude: 56.0153, longitude: 92.8932 },
  "пермь": { name: "Пермь", latitude: 58.0105, longitude: 56.2502 },
  "воронеж": { name: "Воронеж", latitude: 51.6608, longitude: 39.2003 },
  "волгоград": { name: "Волгоград", latitude: 48.708, longitude: 44.5133 },
  "краснодар": { name: "Краснодар", latitude: 45.0355, longitude: 38.9753 },
  "сочи": { name: "Сочи", latitude: 43.5855, longitude: 39.7231 },
};

function describeWmo(code: number): string {
  if (code === 0) return "Ясно";
  if (code === 1) return "Преимущественно ясно";
  if (code === 2) return "Переменная облачность";
  if (code === 3) return "Пасмурно";
  if ([45, 48].includes(code)) return "Туман";
  if ([51, 53, 55].includes(code)) return "Морось";
  if ([56, 57].includes(code)) return "Ледяная морось";
  if ([61, 63, 65].includes(code)) return "Дождь";
  if ([66, 67].includes(code)) return "Ледяной дождь";
  if ([71, 73, 75].includes(code)) return "Снег";
  if (code === 77) return "Снежная крупа";
  if ([80, 81, 82].includes(code)) return "Ливни";
  if ([85, 86].includes(code)) return "Снегопад";
  if (code === 95) return "Гроза";
  if ([96, 99].includes(code)) return "Гроза с градом";
  return "Погода";
}

function getWeatherEmoji(code: number, isDay = true): string {
  const hour = new Date().getHours();
  const isNight = !isDay || hour < 6 || hour >= 21;
  const isEvening = isDay && hour >= 18 && hour < 21;
  const isMorning = isDay && hour >= 6 && hour < 10;

  if (code === 0 || code === 1) {
    if (isNight) return "🌙";
    if (isEvening) return "🌇";
    if (isMorning) return "🌅";
    return "☀️";
  }
  if (code === 2) return isNight ? "☁️" : "⛅";
  if (code === 3) return "☁️";
  if ([45, 48].includes(code)) return "🌫️";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "🌧️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "🌨️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return isNight ? "🌙" : "🌤️";
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rawCity = String(body?.city || "Москва").trim().slice(0, 80) || "Москва";
    const key = rawCity.toLowerCase();
    const knownPlace = RU_CITY_COORDS[key];

    let place: { name: string; latitude: number; longitude: number } | null = knownPlace || null;

    if (!place) {
      const geo = await fetchJson<{ results?: Array<{ name: string; latitude: number; longitude: number; country?: string }> }>(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(rawCity)}&count=1&language=ru&format=json`,
      );
      const found = geo?.results?.[0];
      if (found) {
        place = { name: found.name || rawCity, latitude: found.latitude, longitude: found.longitude };
      }
    }

    if (!place) {
      return new Response(JSON.stringify({ error: "Город не найден" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const weather = await fetchJson<{ current?: { temperature_2m: number; weather_code: number; is_day: number } }>(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code,is_day&timezone=auto`,
    );
    const current = weather?.current;
    if (!current) throw new Error("Weather unavailable");

    const code = Number(current.weather_code);
    const result: WeatherResult = {
      temp: Math.round(Number(current.temperature_2m)),
      description: describeWmo(code),
      icon: getWeatherEmoji(code, Number(current.is_day) === 1),
      city: place.name,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Погода временно недоступна" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});