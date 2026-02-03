import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Label,
  ComposedChart,
} from "recharts";
import {
  Info,
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  Target,
  ChevronRight,
  RefreshCw,
  Sparkles,
  Brain,
  AlertOctagon,
  MessageSquare,
  X,
  Send,
  Bot,
  ThumbsUp,
  ThumbsDown,
  BookOpen,
  ShieldAlert,
  Calendar,
  Clock,
  BarChart2,
  Menu,
  Layout,
  Layers,
  Camera,
  Sigma,
  Zap,
  HelpCircle,
  MousePointerClick,
  RotateCcw,
} from "lucide-react";

// --- 常數設定 ---
const MULTIPLIER = 50; // 台指選擇權 1點 = 50元
const MARGIN_A = 50000; // 概估保證金 A值 (隨期交所變動)
const MARGIN_B = 25000; // 概估保證金 B值
const GAS_API_URL =
  "https://script.google.com/macros/s/AKfycby27zKJ6VNR8ojGzMnb1rcf3u92XjCJZvSuQbfYbjFV3TraTG6oX6kXLWnSfDU6-i1olQ/exec";

// --- 數學模型: Black-Scholes & Greeks ---
const ND = (x) => {
  if (x < -10) return 0;
  if (x > 10) return 1;
  var d1 = 0.049867347,
    d2 = 0.0211410061,
    d3 = 0.0032776263,
    d4 = 0.0000380036,
    d5 = 0.0000488906,
    d6 = 0.000005383;
  var a = Math.abs(x);
  var t = 1.0 / (1.0 + a * 0.2316419);
  var p =
    1.0 -
    0.3989422804014327 *
      Math.exp(-x * x * 0.5) *
      ((((((d6 * t + d5) * t + d4) * t + d3) * t + d2) * t + d1) * t);
  if (x < 0) return 1.0 - p;
  return p;
};

const ND_prime = (x) => {
  return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
};

const calculateOptionGreeks = (S, K, T, r, sigma, type) => {
  if (T <= 0) return { delta: 0, gamma: 0, theta: 0, vega: 0 };

  const d1 =
    (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  let delta, gamma, theta, vega;
  const nd1 = ND(d1);
  const nd1_prime = ND_prime(d1);
  const nd2 = ND(d2);

  if (type === "call") {
    delta = nd1;
    theta =
      (-1 * ((S * sigma * nd1_prime) / (2 * Math.sqrt(T))) -
        r * K * Math.exp(-r * T) * nd2) /
      365;
  } else {
    delta = nd1 - 1;
    theta =
      (-1 * ((S * sigma * nd1_prime) / (2 * Math.sqrt(T))) +
        r * K * Math.exp(-r * T) * (1 - nd2)) /
      365;
  }

  gamma = nd1_prime / (S * sigma * Math.sqrt(T));
  vega = (S * Math.sqrt(T) * nd1_prime) / 100;

  return { delta, gamma, theta, vega };
};

// --- BS 理論價格計算 (對應 Excel 邏輯) ---
const calculateBSPrice = (S, K, T, r, sigma, type) => {
  if (T <= 0) {
    // 過期或到期：回傳內含價值 (Intrinsic Value)
    return type === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
  }

  const d1 =
    (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  if (type === "call") {
    return S * ND(d1) - K * Math.exp(-r * T) * ND(d2);
  } else {
    return K * Math.exp(-r * T) * ND(-d2) - S * ND(-d1);
  }
};

// --- 台灣國定假日設定 (格式 YYYY-MM-DD) ---
// 您可以在此加入假日，計算工作日時會自動排除
const HOLIDAYS = []; // 範例(如"2026-01-01", "2026-02-16", "2026-02-17")

// --- 精確剩餘時數計算 (支援標準日期格式) ---
const calculateRemainingHours = (expiryInput) => {
  const now = new Date();
  let expiryDate;

  // [修正點]：判斷輸入格式
  // 1. 如果是標準日期格式 "2026-02-04" (來自日期選擇器)
  if (typeof expiryInput === "string" && expiryInput.includes("-")) {
    const parts = expiryInput.split("-");
    // 建構當地時間的 Date 物件 (Year, Month-1, Day) 以避免時區誤差
    expiryDate = new Date(
      parseInt(parts[0]),
      parseInt(parts[1]) - 1,
      parseInt(parts[2])
    );
  }
  // 2. 如果是 TXO 代碼格式 "202602W1" (來自策略腳位)
  else if (typeof expiryInput === "string" && expiryInput.match(/^\d{4}/)) {
    expiryDate = parseExpiryCode(expiryInput);
  }
  // 3. 其他情況 (如已經是 Date 物件)
  else {
    expiryDate = new Date(expiryInput);
  }

  // 強制設定結算日為 13:30:00
  expiryDate.setHours(13, 30, 0, 0);

  if (now >= expiryDate) return 0;

  // 1. 計算中間完整的「工作日」
  let fullDays = 0;
  let cursor = new Date(now);
  cursor.setDate(cursor.getDate() + 1); // 從明天開始算
  cursor.setHours(0, 0, 0, 0);

  const endLimit = new Date(expiryDate);
  endLimit.setHours(0, 0, 0, 0);

  while (cursor < endLimit) {
    const day = cursor.getDay();
    // 轉為 YYYY-MM-DD 比對假日
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;

    if (day !== 0 && day !== 6 && !HOLIDAYS.includes(dateStr)) {
      fullDays++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // 2. 計算「當日」剩餘時數
  const currentHour =
    now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  let todayRemaining = 0;

  // 判斷今天是否為結算日
  // (注意：這裡用 cursor 邏輯比對是否同一天)
  const isSameDay =
    now.getFullYear() === expiryDate.getFullYear() &&
    now.getMonth() === expiryDate.getMonth() &&
    now.getDate() === expiryDate.getDate();

  if (isSameDay) {
    // 如果今天就是結算日，只算到 13:30
    todayRemaining = Math.max(0, 13.5 - currentHour);
    return todayRemaining; // 直接回傳，不用加 fullDays
  } else {
    // 非結算日，依照時段計算
    if (currentHour < 8.75) {
      // < 08:45
      todayRemaining = 19;
    } else if (currentHour < 13.75) {
      // < 13:45 (日盤中)
      // 剩餘日盤 + 14小時夜盤
      todayRemaining = 13.75 - currentHour + 14;
    } else if (currentHour < 15.0) {
      // < 15:00 (收盤休息)
      todayRemaining = 14;
    } else {
      // >= 15:00 (夜盤中)
      // 算到隔天凌晨 05:00 (即 29:00)
      todayRemaining = 29 - currentHour;
    }
  }

  // 3. 計算「最後一日」時數 (13:30 - 08:45 = 4.75小時)
  const lastDayHours = 4.75;

  // 總時數 = 中間工作日*19 + 當日剩餘 + 最後一日
  const totalHours = fullDays * 19 + todayRemaining + lastDayHours;

  return Math.max(0, totalHours);
};

// --- 日期代碼解析器 (支援 W週選, F雙週/特定, 與月結) ---
// 規則：Wn=第n個週三, Fn=第n個週五(或視為該週後半), 無後綴=第3個週三(月結)
const parseExpiryCode = (code) => {
  if (!code) return new Date();

  // 格式檢查: YYYYMM + (Wn / Fn / 無)
  // Group 1: YYYY, Group 2: MM, Group 3: Suffix (W1, F1...) or undefined
  const match = code.match(/^(\d{4})(\d{2})([WF]\d)?$/);
  if (!match) return new Date(); // 無法解析則回傳今日

  const year = parseInt(match[1]);
  const month = parseInt(match[2]) - 1; // JS month 0-11
  const suffix = match[3]; // "W1", "F2", or undefined

  // 找出該月所有週三
  let date = new Date(year, month, 1);
  const Wednesdays = [];
  while (date.getMonth() === month) {
    if (date.getDay() === 3) {
      // Wednesday is 3
      Wednesdays.push(new Date(date));
    }
    date.setDate(date.getDate() + 1);
  }

  // 決定目標基準週三
  let targetDate;
  if (!suffix) {
    // 無後綴：通常是月結，即第 3 個週三
    targetDate = Wednesdays[2] || Wednesdays[Wednesdays.length - 1];
  } else {
    const type = suffix.charAt(0); // 'W' or 'F'
    const index = parseInt(suffix.slice(1)) - 1; // 1-based to 0-based

    // 取得對應週次的週三
    const baseWednesday =
      Wednesdays[index] || Wednesdays[Wednesdays.length - 1];

    if (type === "W") {
      targetDate = baseWednesday;
    } else if (type === "F") {
      // F 表示該週的後半 (通常是週五? 或單純排序在 W 之後)
      // 這裡我們設定為週三 + 2天 (即週五)，以符合 W1 -> F1 -> W2 的排序邏輯
      targetDate = new Date(baseWednesday);
      targetDate.setDate(targetDate.getDate() + 2);
    }
  }

  // 設定時間為當天 13:45 (模擬收盤)
  if (targetDate) targetDate.setHours(13, 45, 0, 0);
  return targetDate || new Date();
};

const getDaysUntilExpiry = (expiryCodeOrDate) => {
  let targetDate;
  if (
    typeof expiryCodeOrDate === "string" &&
    expiryCodeOrDate.match(/^\d{4}/)
  ) {
    targetDate = parseExpiryCode(expiryCodeOrDate);
  } else {
    targetDate = new Date(expiryCodeOrDate);
  }

  // 設定為當天 13:45 收盤 (模擬)
  targetDate.setHours(13, 45, 0, 0);

  const now = new Date();
  const diffTime = targetDate - now;
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  return diffDays; // 可回傳負值代表已過期
};

// --- 新增：匯入文字解析器 ---
const parseImportText = (text) => {
  const lines = text.split("\n").filter((l) => l.trim());
  const newLegs = [];

  // Regex 對應格式: 【202602W1】 32500 Long Put 4口 (每口權利金164)
  // Group 1: Expiry, 2: Strike, 3: Action, 4: Type, 5: Qty, 6: Price
  const regex =
    /【(.*?)】\s*(\d+)\s*(Long|Short)\s*(Call|Put)\s*(\d+)口\s*\(每口權利金([\d.]+)\)/i;

  lines.forEach((line) => {
    const match = line.match(regex);
    if (match) {
      newLegs.push({
        id: Date.now() + Math.random(), // 產生臨時 ID
        expiryCode: match[1],
        strike: parseFloat(match[2]),
        action: match[3].toLowerCase() === "long" ? "buy" : "sell",
        type: match[4].toLowerCase(),
        quantity: parseFloat(match[5]),
        premium: parseFloat(match[6]),
      });
    }
  });
  return newLegs;
};

// --- 預設輸入值 (修正：讓價差策略更貼近現價) ---
const DEFAULT_INPUTS = {
  currentPrice: 32000,
  riskFreeRate: 2.0,
  strike: 32000,
  premium: 350,
  vix: 16,
  volCorrection: 50,
  // Spreads
  lowerStrike: 31800,
  lowerPremium: 200,
  higherStrike: 32200,
  higherPremium: 80,
  middleStrike: 32000,
  middlePremium: 150,
  // Straddle/Strangle
  callPremium: 250,
  putPremium: 280,
  // Iron Condor
  putK1: 31600,
  putK1Premium: 40,
  putK2: 31800,
  putK2Premium: 120,
  callK3: 32200,
  callK3Premium: 110,
  callK4: 32400,
  callK4Premium: 30,
  // Iron Butterfly
  lowerPutK: 31800,
  lowerPutPremium: 150,
  centerStrike: 32000,
  centerPutPremium: 300,
  centerCallPremium: 320,
  higherCallK: 32200,
  higherCallPremium: 140,
  // --- 自組策略預設值 ---
  customLegs: [
    {
      id: 1,
      action: "buy",
      type: "call",
      strike: 32000,
      premium: 350,
      quantity: 1,
    },
  ],
  // === 模擬演練的資料欄位 (Step 1 修改) ===
  simulationALegs: [],
  simulationBLegs: [],
  simulationCLegs: [],
};

// === 自訂策略產生器 (放在 strategies 上方) ===
const createPortfolioStrategy = (id, name, dataKey) => ({
  id: id,
  group: "自訂策略",
  name: name,
  sentiment: "多空/多期",
  description: "支援多到期日混合分析，即時運算理論損益。",
  inputs: [],
  getLegs: (inputs) => {
    // 動態讀取對應的 Key (customLegs, simulationALegs...)
    const rawLegs = inputs[dataKey] || [];
    const expandedLegs = [];
    rawLegs.forEach((leg) => {
      for (let i = 0; i < (leg.quantity || 1); i++) {
        expandedLegs.push({ ...leg });
      }
    });
    return expandedLegs;
  },
  calculate: (inputs) => {
    const legs = inputs[dataKey] || [];
    const currentPrice = safeFloat(inputs.currentPrice);
    const r = safeFloat(inputs.riskFreeRate) / 100;
    const sigma = safeFloat(inputs.vix) / 100;
    const mode = inputs.analysisMode || "expiry";

    const getPnL = (price) => {
      let totalPnL = 0;
      legs.forEach((leg) => {
        const k = safeFloat(leg.strike);
        const p = safeFloat(leg.premium);
        const q = safeFloat(leg.quantity, 1);
        let estimatedValue;

        if (mode === "theoretical") {
          const hours = calculateRemainingHours(leg.expiryCode);
          const days = hours / 19;
          const T = Math.max(days, 0) / 365;
          if (T <= 0.001) {
            estimatedValue =
              leg.type === "call"
                ? Math.max(0, price - k)
                : Math.max(0, k - price);
          } else {
            estimatedValue = calculateBSPrice(price, k, T, r, sigma, leg.type);
          }
        } else {
          estimatedValue =
            leg.type === "call"
              ? Math.max(0, price - k)
              : Math.max(0, k - price);
        }

        if (leg.action === "buy") {
          totalPnL += (estimatedValue - p) * q;
        } else {
          totalPnL += (p - estimatedValue) * q;
        }
      });
      return totalPnL;
    };

    const center = currentPrice;
    const range = 4000;
    let maxP = -Infinity;
    let maxL = Infinity;
    let breakEvens = [];
    const step = 10;
    let prevPnL = getPnL(center - range);

    for (
      let price = center - range + step;
      price <= center + range;
      price += step
    ) {
      const currentPnL = getPnL(price);
      if (currentPnL > maxP) maxP = currentPnL;
      if (currentPnL < maxL) maxL = currentPnL;

      if (
        (prevPnL < 0 && currentPnL >= 0) ||
        (prevPnL > 0 && currentPnL <= 0)
      ) {
        const slope = currentPnL - prevPnL;
        if (Math.abs(slope) > 0.0001) {
          const exactPrice = price - step + ((0 - prevPnL) * step) / slope;
          if (
            breakEvens.length === 0 ||
            Math.abs(exactPrice - breakEvens[breakEvens.length - 1]) > 1
          ) {
            breakEvens.push(Math.round(exactPrice));
          }
        }
      }
      prevPnL = currentPnL;
    }

    let estimatedMargin = 0;
    legs.forEach((leg) => {
      if (leg.action === "sell") {
        const k = safeFloat(leg.strike);
        const p = safeFloat(leg.premium);
        const otm =
          leg.type === "call"
            ? Math.max(0, k - center)
            : Math.max(0, center - k);
        const marketValue = p * MULTIPLIER;
        estimatedMargin +=
          (marketValue + Math.max(MARGIN_A - otm * MULTIPLIER, MARGIN_B)) *
          safeFloat(leg.quantity, 1);
      }
    });

    return {
      maxProfitPoints: maxP,
      maxLossPoints: Math.abs(maxL),
      breakEven: breakEvens,
      getPnL: getPnL,
      margin: estimatedMargin,
    };
  },
  details: {
    when: "全方位監控",
    features: ["支援不同到期日", "T+0 理論損益", "即時評價"],
    pros: ["真實反映現況"],
    cons: ["依賴 VIX 準確度"],
  },
});

// --- 工具函式 ---
const getDefaultExpiryDate = () => {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const hour = now.getHours();
  let daysUntilWed = 0;
  if (dayOfWeek < 3) {
    daysUntilWed = 3 - dayOfWeek;
  } else if (dayOfWeek > 3) {
    daysUntilWed = 3 - dayOfWeek + 7;
  } else {
    daysUntilWed = hour >= 13 ? 7 : 0;
  }
  const targetDate = new Date(now);
  targetDate.setDate(now.getDate() + daysUntilWed);
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, "0");
  const day = String(targetDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const calculateTradingDays = (expiryDateStr) => {
  const start = new Date();
  const end = new Date(expiryDateStr);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (end < start) return 0;
  if (end.getTime() === start.getTime()) return 0.5;
  let count = 0;
  let current = new Date(start);
  current.setDate(current.getDate() + 1);
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
};

const safeFloat = (val, defaultVal = 0) => {
  if (val === null || val === undefined) return defaultVal;
  const strVal = String(val).replace(/,/g, "");
  const num = parseFloat(strVal);
  return isNaN(num) ? defaultVal : num;
};

const formatCurrency = (val) => {
  if (val === Infinity) return "無限";
  if (val === -Infinity) return "-無限";
  const num = safeFloat(val);
  return (
    "NT$ " +
    Math.round(num)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  );
};

const formatPoints = (val) => {
  if (val === Infinity) return "無限";
  if (val === -Infinity) return "-無限";
  const num = safeFloat(val);
  return `${num.toFixed(1)} 點`;
};

// --- 策略定義 ---
const strategies = {
  longCall: {
    id: "longCall",
    group: "單邊基礎",
    name: "買進買權 (Long Call)",
    sentiment: "看大漲",
    description: "最大損失為權利金，獲利無限。",
    inputs: [
      { id: "strike", label: "履約價 (Call)" },
      { id: "premium", label: "權利金 (Call)" },
    ],
    getLegs: (inputs) => [
      { type: "call", action: "buy", strike: inputs.strike },
    ],
    calculate: (inputs) => {
      const k = safeFloat(inputs.strike);
      const p = safeFloat(inputs.premium);
      return {
        maxProfitPoints: Infinity,
        maxLossPoints: p,
        breakEven: [k + p],
        getPnL: (price) => Math.max(0, price - k) - p,
        margin: 0,
      };
    },
    details: {
      when: "預期指數大漲",
      features: ["槓桿高"],
      pros: ["以小博大"],
      cons: ["時間價值流失"],
    },
  },
  longPut: {
    id: "longPut",
    group: "單邊基礎",
    name: "買進賣權 (Long Put)",
    sentiment: "看大跌",
    description: "最大損失為權利金，獲利隨跌幅增加。",
    inputs: [
      { id: "strike", label: "履約價 (Put)" },
      { id: "premium", label: "權利金 (Put)" },
    ],
    getLegs: (inputs) => [
      { type: "put", action: "buy", strike: inputs.strike },
    ],
    calculate: (inputs) => {
      const k = safeFloat(inputs.strike);
      const p = safeFloat(inputs.premium);
      return {
        maxProfitPoints: k - p,
        maxLossPoints: p,
        breakEven: [k - p],
        getPnL: (price) => Math.max(0, k - price) - p,
        margin: 0,
      };
    },
    details: {
      when: "預期指數大跌",
      features: ["避險首選"],
      pros: ["虧損有限"],
      cons: ["需大跌才獲利"],
    },
  },
  shortCall: {
    id: "shortCall",
    group: "單邊基礎",
    name: "賣出買權 (Short Call)",
    sentiment: "看跌/不過高",
    description: "當賣方收租。風險無限，需注意保證金。",
    inputs: [
      { id: "strike", label: "履約價 (Call)" },
      { id: "premium", label: "權利金 (Call)" },
    ],
    getLegs: (inputs) => [
      { type: "call", action: "sell", strike: inputs.strike },
    ],
    calculate: (inputs, currentPrice) => {
      const k = safeFloat(inputs.strike);
      const p = safeFloat(inputs.premium);
      const cp = safeFloat(currentPrice);
      const marketValue = p * MULTIPLIER;
      const otm = Math.max(0, k - cp) * MULTIPLIER;
      const margin = marketValue + Math.max(MARGIN_A - otm, MARGIN_B);
      return {
        maxProfitPoints: p,
        maxLossPoints: Infinity,
        breakEven: [k + p],
        getPnL: (price) => p - Math.max(0, price - k),
        margin: margin,
      };
    },
    details: {
      when: "看空或盤整",
      features: ["收時間價值"],
      pros: ["勝率高"],
      cons: ["風險無限"],
    },
  },
  shortPut: {
    id: "shortPut",
    group: "單邊基礎",
    name: "賣出賣權 (Short Put)",
    sentiment: "看漲/不破低",
    description: "當賣方收租。若遇大跌風險極高。",
    inputs: [
      { id: "strike", label: "履約價 (Put)" },
      { id: "premium", label: "權利金 (Put)" },
    ],
    getLegs: (inputs) => [
      { type: "put", action: "sell", strike: inputs.strike },
    ],
    calculate: (inputs, currentPrice) => {
      const k = safeFloat(inputs.strike);
      const p = safeFloat(inputs.premium);
      const cp = safeFloat(currentPrice);
      const marketValue = p * MULTIPLIER;
      const otm = Math.max(0, cp - k) * MULTIPLIER;
      const margin = marketValue + Math.max(MARGIN_A - otm, MARGIN_B);
      return {
        maxProfitPoints: p,
        maxLossPoints: k - p,
        breakEven: [k - p],
        getPnL: (price) => p - Math.max(0, k - price),
        margin: margin,
      };
    },
    details: {
      when: "看多或盤整",
      features: ["巴菲特策略"],
      pros: ["勝率高"],
      cons: ["接刀風險"],
    },
  },
  bullCallSpread: {
    id: "bullCallSpread",
    group: "垂直價差",
    name: "買權多頭價差 (Bull Call)",
    sentiment: "溫和看漲 (Debit)",
    description: "買低Call + 賣高Call。",
    inputs: [
      { id: "lowerStrike", label: "買進 低履約價 (Call)" },
      { id: "lowerPremium", label: "買進 權利金 (Call)" },
      { id: "higherStrike", label: "賣出 高履約價 (Call)" },
      { id: "higherPremium", label: "賣出 權利金 (Call)" },
    ],
    getLegs: (inputs) => [
      { type: "call", action: "buy", strike: inputs.lowerStrike },
      { type: "call", action: "sell", strike: inputs.higherStrike },
    ],
    calculate: (inputs) => {
      const k1 = safeFloat(inputs.lowerStrike);
      const p1 = safeFloat(inputs.lowerPremium);
      const k2 = safeFloat(inputs.higherStrike);
      const p2 = safeFloat(inputs.higherPremium);
      const debit = p1 - p2;
      return {
        maxProfitPoints: k2 - k1 - debit,
        maxLossPoints: debit,
        breakEven: [k1 + debit],
        getPnL: (price) => {
          const long = Math.max(0, price - k1);
          const short = -Math.max(0, price - k2);
          return long + short - debit;
        },
        margin: 0,
      };
    },
    details: {
      when: "溫和看漲",
      features: ["成本降低"],
      pros: ["風險有限"],
      cons: ["獲利封頂"],
    },
  },
  bullPutSpread: {
    id: "bullPutSpread",
    group: "垂直價差",
    name: "賣權多頭價差 (Bull Put)",
    sentiment: "溫和看漲 (Credit)",
    description: "賣高Put + 買低Put。",
    inputs: [
      { id: "lowerStrike", label: "買進 低履約價 (Put)" },
      { id: "lowerPremium", label: "買進 權利金 (Put)" },
      { id: "higherStrike", label: "賣出 高履約價 (Put)" },
      { id: "higherPremium", label: "賣出 權利金 (Put)" },
    ],
    getLegs: (inputs) => [
      { type: "put", action: "buy", strike: inputs.lowerStrike },
      { type: "put", action: "sell", strike: inputs.higherStrike },
    ],
    calculate: (inputs) => {
      const k1 = safeFloat(inputs.lowerStrike);
      const p1 = safeFloat(inputs.lowerPremium);
      const k2 = safeFloat(inputs.higherStrike);
      const p2 = safeFloat(inputs.higherPremium);
      const credit = p2 - p1;
      return {
        maxProfitPoints: credit,
        maxLossPoints: k2 - k1 - credit,
        breakEven: [k2 - credit],
        getPnL: (price) => {
          const long = Math.max(0, k1 - price);
          const short = -Math.max(0, k2 - price);
          return long + short + credit;
        },
        margin: (k2 - k1) * MULTIPLIER,
      };
    },
    details: {
      when: "溫和看漲",
      features: ["收租且有保護"],
      pros: ["勝率高"],
      cons: ["賠率較差"],
    },
  },
  bearCallSpread: {
    id: "bearCallSpread",
    group: "垂直價差",
    name: "買權空頭價差 (Bear Call)",
    sentiment: "溫和看跌 (Credit)",
    description: "賣低Call + 買高Call。",
    inputs: [
      { id: "lowerStrike", label: "賣出 低履約價 (Call)" },
      { id: "lowerPremium", label: "賣出 權利金 (Call)" },
      { id: "higherStrike", label: "買進 高履約價 (Call)" },
      { id: "higherPremium", label: "買進 權利金 (Call)" },
    ],
    getLegs: (inputs) => [
      { type: "call", action: "sell", strike: inputs.lowerStrike },
      { type: "call", action: "buy", strike: inputs.higherStrike },
    ],
    calculate: (inputs) => {
      const k1 = safeFloat(inputs.lowerStrike);
      const p1 = safeFloat(inputs.lowerPremium);
      const k2 = safeFloat(inputs.higherStrike);
      const p2 = safeFloat(inputs.higherPremium);
      const credit = p1 - p2;
      return {
        maxProfitPoints: credit,
        maxLossPoints: k2 - k1 - credit,
        breakEven: [k1 + credit],
        getPnL: (price) => {
          const long = Math.max(0, price - k2);
          const short = -Math.max(0, price - k1);
          return long + short + credit;
        },
        margin: (k2 - k1) * MULTIPLIER,
      };
    },
    details: {
      when: "溫和看跌",
      features: ["收租且有保護"],
      pros: ["勝率高"],
      cons: ["賠率較差"],
    },
  },
  bearPutSpread: {
    id: "bearPutSpread",
    group: "垂直價差",
    name: "賣權空頭價差 (Bear Put)",
    sentiment: "溫和看跌 (Debit)",
    description: "買高Put + 賣低Put。",
    inputs: [
      { id: "lowerStrike", label: "賣出 低履約價 (Put)" },
      { id: "lowerPremium", label: "賣出 權利金 (Put)" },
      { id: "higherStrike", label: "買進 高履約價 (Put)" },
      { id: "higherPremium", label: "買進 權利金 (Put)" },
    ],
    getLegs: (inputs) => [
      { type: "put", action: "sell", strike: inputs.lowerStrike },
      { type: "put", action: "buy", strike: inputs.higherStrike },
    ],
    calculate: (inputs) => {
      const k1 = safeFloat(inputs.lowerStrike);
      const p1 = safeFloat(inputs.lowerPremium);
      const k2 = safeFloat(inputs.higherStrike);
      const p2 = safeFloat(inputs.higherPremium);
      const debit = p2 - p1;
      return {
        maxProfitPoints: k2 - k1 - debit,
        maxLossPoints: debit,
        breakEven: [k2 - debit],
        getPnL: (price) => {
          const long = Math.max(0, k2 - price);
          const short = -Math.max(0, k1 - price);
          return long + short - debit;
        },
        margin: 0,
      };
    },
    details: {
      when: "溫和看跌",
      features: ["成本降低"],
      pros: ["風險有限"],
      cons: ["獲利封頂"],
    },
  },
  longStraddle: {
    id: "longStraddle",
    group: "波動率/中性",
    name: "買進跨式 (Straddle)",
    sentiment: "大波動",
    description: "買進同價位 Call + Put。",
    inputs: [
      { id: "strike", label: "同履約價 (Call & Put)" },
      { id: "callPremium", label: "權利金 (Call)" },
      { id: "putPremium", label: "權利金 (Put)" },
    ],
    getLegs: (inputs) => [
      { type: "call", action: "buy", strike: inputs.strike },
      { type: "put", action: "buy", strike: inputs.strike },
    ],
    calculate: (inputs) => {
      const k = safeFloat(inputs.strike);
      const cost = safeFloat(inputs.callPremium) + safeFloat(inputs.putPremium);
      return {
        maxProfitPoints: Infinity,
        maxLossPoints: cost,
        breakEven: [k - cost, k + cost],
        getPnL: (price) =>
          Math.max(0, price - k) + Math.max(0, k - price) - cost,
        margin: 0,
      };
    },
    details: {
      when: "大變盤前夕",
      features: ["雙向買方"],
      pros: ["無限獲利"],
      cons: ["成本極高"],
    },
  },
  longStrangle: {
    id: "longStrangle",
    group: "波動率/中性",
    name: "買進勒式 (Strangle)",
    sentiment: "大波動",
    description: "買低Put + 買高Call。",
    inputs: [
      { id: "lowerStrike", label: "較低履約價 (Put)" },
      { id: "putPremium", label: "權利金 (Put)" },
      { id: "higherStrike", label: "較高履約價 (Call)" },
      { id: "callPremium", label: "權利金 (Call)" },
    ],
    getLegs: (inputs) => [
      { type: "put", action: "buy", strike: inputs.lowerStrike },
      { type: "call", action: "buy", strike: inputs.higherStrike },
    ],
    calculate: (inputs) => {
      const k1 = safeFloat(inputs.lowerStrike);
      const p1 = safeFloat(inputs.putPremium);
      const k2 = safeFloat(inputs.higherStrike);
      const p2 = safeFloat(inputs.callPremium);
      const cost = p1 + p2;
      return {
        maxProfitPoints: Infinity,
        maxLossPoints: cost,
        breakEven: [k1 - cost, k2 + cost],
        getPnL: (price) =>
          Math.max(0, k1 - price) + Math.max(0, price - k2) - cost,
        margin: 0,
      };
    },
    details: {
      when: "大變盤但想省成本",
      features: ["成本較低"],
      pros: ["無限獲利"],
      cons: ["損益兩平點遠"],
    },
  },
  ironCondor: {
    id: "ironCondor",
    group: "波動率/中性",
    name: "鐵兀鷹 (Iron Condor)",
    sentiment: "區間盤整",
    description: "賣出寬跨式 + 買進外圍保護。",
    inputs: [
      { id: "putK1", label: "買 Put K1 (低)" },
      { id: "putK1Premium", label: "權利金 (K1)" },
      { id: "putK2", label: "賣 Put K2 (次低)" },
      { id: "putK2Premium", label: "權利金 (K2)" },
      { id: "callK3", label: "賣 Call K3 (次高)" },
      { id: "callK3Premium", label: "權利金 (K3)" },
      { id: "callK4", label: "買 Call K4 (高)" },
      { id: "callK4Premium", label: "權利金 (K4)" },
    ],
    getLegs: (inputs) => [
      { type: "put", action: "buy", strike: inputs.putK1 },
      { type: "put", action: "sell", strike: inputs.putK2 },
      { type: "call", action: "sell", strike: inputs.callK3 },
      { type: "call", action: "buy", strike: inputs.callK4 },
    ],
    calculate: (inputs) => {
      const k1 = safeFloat(inputs.putK1);
      const p1 = safeFloat(inputs.putK1Premium);
      const k2 = safeFloat(inputs.putK2);
      const p2 = safeFloat(inputs.putK2Premium);
      const k3 = safeFloat(inputs.callK3);
      const p3 = safeFloat(inputs.callK3Premium);
      const k4 = safeFloat(inputs.callK4);
      const p4 = safeFloat(inputs.callK4Premium);
      const credit = p2 + p3 - (p1 + p4);
      const spreadWidth = Math.max(k2 - k1, k4 - k3);
      return {
        maxProfitPoints: credit,
        maxLossPoints: spreadWidth - credit,
        breakEven: [k2 - credit, k3 + credit],
        getPnL: (price) => {
          const putSide = Math.max(0, k1 - price) - Math.max(0, k2 - price);
          const callSide = Math.max(0, price - k4) - Math.max(0, price - k3);
          return putSide + callSide + credit;
        },
        margin: spreadWidth * MULTIPLIER,
      };
    },
    details: {
      when: "區間盤整",
      features: ["四隻腳部位"],
      pros: ["風險有限"],
      cons: ["手續費高"],
    },
  },
  ironButterfly: {
    id: "ironButterfly",
    group: "波動率/中性",
    name: "鐵蝴蝶 (Iron Butterfly)",
    sentiment: "區間盤整",
    description: "賣出跨式 + 買進外圍保護。",
    inputs: [
      { id: "lowerPutK", label: "買進 低履約價 (Put)" },
      { id: "lowerPutPremium", label: "權利金 (Put)" },
      { id: "centerStrike", label: "賣出 中履約價 (Call & Put)" },
      { id: "centerPutPremium", label: "賣Put 權利金" },
      { id: "centerCallPremium", label: "賣Call 權利金" },
      { id: "higherCallK", label: "買進 高履約價 (Call)" },
      { id: "higherCallPremium", label: "權利金 (Call)" },
    ],
    getLegs: (inputs) => [
      { type: "put", action: "buy", strike: inputs.lowerPutK },
      { type: "put", action: "sell", strike: inputs.centerStrike },
      { type: "call", action: "sell", strike: inputs.centerStrike },
      { type: "call", action: "buy", strike: inputs.higherCallK },
    ],
    calculate: (inputs) => {
      const k1 = safeFloat(inputs.lowerPutK);
      const p1 = safeFloat(inputs.lowerPutPremium);
      const k2 = safeFloat(inputs.centerStrike);
      const p2_put = safeFloat(inputs.centerPutPremium);
      const p2_call = safeFloat(inputs.centerCallPremium);
      const k3 = safeFloat(inputs.higherCallK);
      const p3 = safeFloat(inputs.higherCallPremium);
      const credit = p2_put + p2_call - (p1 + p3);
      const width = Math.min(k2 - k1, k3 - k2);
      return {
        maxProfitPoints: credit,
        maxLossPoints: width - credit,
        breakEven: [k2 - credit, k2 + credit],
        getPnL: (price) => {
          const l_put = Math.max(0, k1 - price);
          const s_put = -Math.max(0, k2 - price);
          const s_call = -Math.max(0, price - k2);
          const l_call = Math.max(0, price - k3);
          return l_put + s_put + s_call + l_call + credit;
        },
        margin: width * MULTIPLIER,
      };
    },
    details: {
      when: "窄幅盤整",
      features: ["高權利金收入"],
      pros: ["獲利集中"],
      cons: ["損益平衡點窄"],
    },
  },

  // === 使用產生器建立自訂與模擬策略 (Step 1 修改) ===
  custom: createPortfolioStrategy(
    "custom",
    "自組部位監控 (Portfolio)",
    "customLegs"
  ),
  simulationA: createPortfolioStrategy(
    "simulationA",
    "模擬演練 A",
    "simulationALegs"
  ),
  simulationB: createPortfolioStrategy(
    "simulationB",
    "模擬演練 B",
    "simulationBLegs"
  ),
  simulationC: createPortfolioStrategy(
    "simulationC",
    "模擬演練 C",
    "simulationCLegs"
  ),
};

// --- 更新後的自組策略構建器 ---
const CustomStrategyBuilder = ({
  legs,
  onChange,
  currentPrice,
  analysisMode,
  onModeChange,
}) => {
  const [importText, setImportText] = useState("");

  const handleClearAll = () => {
    if (window.confirm("確定要清空所有自訂部位嗎？")) {
      onChange([]);
    }
  };

  const handleImport = () => {
    const parsedLegs = parseImportText(importText);
    if (parsedLegs.length > 0) {
      onChange([...legs, ...parsedLegs]);
      setImportText("");
      alert(`成功匯入 ${parsedLegs.length} 筆部位！`);
    } else {
      alert("無法解析格式，請檢查文字內容。");
    }
  };

  const addLeg = () => {
    const newId = legs.length > 0 ? Math.max(...legs.map((l) => l.id)) + 1 : 1;
    const defaultStrike = Math.round(safeFloat(currentPrice) / 100) * 100;
    const now = new Date();
    const defaultExpiry = `${now.getFullYear()}${String(
      now.getMonth() + 1
    ).padStart(2, "0")}`;

    const newLeg = {
      id: newId,
      expiryCode: defaultExpiry,
      action: "buy",
      type: "call",
      strike: defaultStrike || 16000,
      premium: 100,
      quantity: 1,
    };
    onChange([...legs, newLeg]);
  };

  const removeLeg = (id) => onChange(legs.filter((l) => l.id !== id));

  const updateLeg = (id, field, value) => {
    const newLegs = legs.map((leg) =>
      leg.id === id ? { ...leg, [field]: value } : leg
    );
    onChange(newLegs);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-white dark:bg-slate-700 p-3 rounded-lg border border-slate-200 dark:border-slate-600 shadow-sm">
        <div className="flex items-center gap-2">
          <div
            className={`p-2 rounded-lg ${
              analysisMode === "theoretical"
                ? "bg-purple-100 text-purple-600"
                : "bg-blue-100 text-blue-600"
            }`}
          >
            {analysisMode === "theoretical" ? (
              <Activity className="w-5 h-5" />
            ) : (
              <Target className="w-5 h-5" />
            )}
          </div>
          <div>
            <div className="text-sm font-bold text-slate-800 dark:text-white">
              {analysisMode === "theoretical"
                ? "理論損益 (T+0)"
                : "到期結算 (Expiry)"}
            </div>
            <div className="text-xs text-slate-500">
              {analysisMode === "theoretical"
                ? "含時間價值 (曲線)"
                : "到期整體結構 (折線)"}
            </div>
          </div>
        </div>
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-600">
          <button
            onClick={() => onModeChange("expiry")}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
              analysisMode !== "theoretical"
                ? "bg-white dark:bg-slate-600 shadow text-blue-600 dark:text-blue-300"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            到期
          </button>
          <button
            onClick={() => onModeChange("theoretical")}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
              analysisMode === "theoretical"
                ? "bg-white dark:bg-slate-600 shadow text-purple-600 dark:text-purple-300"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            T+0
          </button>
        </div>
      </div>
      <div className="bg-slate-100 dark:bg-slate-700/50 p-3 rounded-lg border border-slate-200 dark:border-slate-600">
        <label className="text-xs font-bold text-slate-500 mb-2 block">
          快速匯入與管理
        </label>
        <div className="flex gap-2">
          <textarea
            className="flex-1 text-xs p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-white font-mono h-20"
            placeholder="例如：【202602W1】 32500 Long Put 4口..."
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <div className="flex flex-col gap-2">
            <button
              onClick={handleImport}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 rounded text-sm font-bold flex flex-col items-center justify-center min-w-[80px]"
            >
              <RefreshCw className="w-4 h-4 mb-1" /> 匯入
            </button>
            <button
              onClick={handleClearAll}
              className="flex-1 bg-slate-200 dark:bg-slate-600 hover:bg-rose-500 hover:text-white text-slate-600 dark:text-slate-200 px-4 rounded text-sm font-bold flex flex-col items-center justify-center transition-colors"
            >
              <X className="w-4 h-4 mb-1" /> 清除
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
          <thead className="text-xs text-slate-700 uppercase bg-slate-100 dark:bg-slate-700 dark:text-slate-200">
            <tr>
              <th className="px-2 py-2">到期日</th>
              <th className="px-2 py-2">買/賣</th>
              <th className="px-2 py-2">類型</th>
              <th className="px-2 py-2">履約價</th>
              <th className="px-2 py-2">權利金</th>
              <th className="px-2 py-2">口數</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {legs.map((leg) => (
              <tr
                key={leg.id}
                className="bg-white dark:bg-slate-800 border-b dark:border-slate-700"
              >
                <td className="px-2 py-2">
                  <input
                    type="text"
                    value={leg.expiryCode || ""}
                    onChange={(e) =>
                      updateLeg(leg.id, "expiryCode", e.target.value)
                    }
                    className="w-24 bg-transparent border border-slate-300 dark:border-slate-600 rounded px-1 py-1 text-xs text-center"
                    placeholder="202602W1"
                  />
                </td>
                <td className="px-2 py-2">
                  <select
                    value={leg.action}
                    onChange={(e) =>
                      updateLeg(leg.id, "action", e.target.value)
                    }
                    className={`border rounded px-1 py-1 text-xs font-bold w-16 ${
                      leg.action === "buy"
                        ? "text-rose-600 bg-rose-50"
                        : "text-emerald-600 bg-emerald-50"
                    }`}
                  >
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                </td>
                <td className="px-2 py-2">
                  <select
                    value={leg.type}
                    onChange={(e) => updateLeg(leg.id, "type", e.target.value)}
                    className="bg-transparent border border-slate-300 dark:border-slate-600 rounded px-1 py-1 text-xs w-16"
                  >
                    <option value="call">Call</option>
                    <option value="put">Put</option>
                  </select>
                </td>
                <td className="px-2 py-2">
                  {/* 修正：將 w-16 改為 w-24，增加寬度 */}
                  <input
                    type="number"
                    value={leg.strike}
                    onChange={(e) =>
                      updateLeg(leg.id, "strike", parseFloat(e.target.value))
                    }
                    className="w-24 bg-transparent border border-slate-300 dark:border-slate-600 rounded px-1 text-right"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    value={leg.premium}
                    onChange={(e) =>
                      updateLeg(leg.id, "premium", parseFloat(e.target.value))
                    }
                    className="w-16 bg-transparent border border-slate-300 dark:border-slate-600 rounded px-1 text-right"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    value={leg.quantity}
                    onChange={(e) =>
                      updateLeg(leg.id, "quantity", parseFloat(e.target.value))
                    }
                    className="w-12 bg-transparent border border-slate-300 dark:border-slate-600 rounded px-1 text-right"
                  />
                </td>
                <td className="px-2 py-2">
                  <button
                    onClick={() => removeLeg(leg.id)}
                    className="text-slate-400 hover:text-rose-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={addLeg}
          className="mt-2 w-full py-2 border-2 border-dashed border-slate-300 rounded text-slate-500 hover:border-blue-400 text-sm font-medium"
        >
          <TrendingUp className="w-4 h-4 mr-1 inline" /> 新增腳位
        </button>
      </div>
    </div>
  );
};

const InputField = ({ label, name, value, onChange }) => (
  <div className="flex flex-col space-y-1">
    <label
      className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide truncate"
      title={label}
    >
      {label}
    </label>
    <input
      type="number"
      name={name}
      value={value}
      onChange={onChange}
      className="block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-right font-mono text-sm shadow-sm transition-all hover:border-blue-300"
      placeholder="0"
    />
  </div>
);

// --- 修正 ResultCard：加入距離現價的計算 ---
const ResultCard = ({
  title,
  points,
  type,
  subText,
  subPoints,
  currentPrice,
}) => {
  let colorClass = "text-slate-900 dark:text-white";
  let bgClass = "bg-white dark:bg-slate-800";
  let icon = <Info className="w-5 h-5 text-slate-400" />;
  const isInf = points === Infinity || points === -Infinity;
  const displayPoints = formatPoints(points);
  const displayMoney = formatCurrency(isInf ? points : points * MULTIPLIER);

  if (type === "profit") {
    colorClass = "text-rose-600 dark:text-rose-400";
    icon = <TrendingUp className="w-5 h-5 text-rose-500" />;
    bgClass =
      "bg-rose-50 dark:bg-rose-900/10 border-rose-100 dark:border-rose-800";
  } else if (type === "loss") {
    colorClass = "text-emerald-600 dark:text-emerald-400";
    icon = <TrendingDown className="w-5 h-5 text-emerald-500" />;
    bgClass =
      "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-800";
  } else if (type === "ratio") {
    colorClass = "text-indigo-600 dark:text-indigo-400";
    icon = <AlertOctagon className="w-5 h-5 text-indigo-500" />;
    bgClass =
      "bg-indigo-50 dark:bg-indigo-900/10 border-indigo-100 dark:border-indigo-800";
  } else if (type === "breakEven") {
    colorClass = "text-blue-600 dark:text-blue-400";
    icon = <Target className="w-5 h-5 text-blue-500" />;
  } else if (type === "margin") {
    colorClass = "text-amber-600 dark:text-amber-400";
    icon = <ShieldAlert className="w-5 h-5 text-amber-500" />;
    bgClass =
      "bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-800";
  } else if (type === "volatility") {
    colorClass = "text-purple-600 dark:text-purple-400";
    icon = <Activity className="w-5 h-5 text-purple-500" />;
    bgClass =
      "bg-purple-50 dark:bg-purple-900/10 border-purple-100 dark:border-purple-800";
  }

  const mainContent =
    type === "breakEven"
      ? Array.isArray(points)
        ? points.map((p) => Math.round(p)).join(" / ")
        : Math.round(points)
      : type === "margin"
      ? formatCurrency(points)
      : Array.isArray(points)
      ? points.map((p) => Math.round(p)).join(" / ")
      : displayPoints;

  // 計算距離現價
  let distanceText = null;
  if (
    (type === "breakEven" || type === "profit" || type === "loss") &&
    subPoints &&
    subPoints.length > 0 &&
    currentPrice &&
    !isInf
  ) {
    // 找出最接近的點位計算
    const targets = Array.isArray(subPoints) ? subPoints : [subPoints];
    const validTargets = targets.filter((t) => t > 0);
    if (validTargets.length > 0) {
      const diffs = validTargets.map((t) => {
        const diff = t - currentPrice;
        const percent = (diff / currentPrice) * 100;
        return { diff, percent };
      });
      // 顯示第一個或用 / 分隔
      distanceText = diffs
        .map((d) => {
          const sign = d.diff > 0 ? "+" : "";
          return `${sign}${Math.round(d.diff)} (${sign}${d.percent.toFixed(
            2
          )}%)`;
        })
        .join(" / ");
    }
  } else if (type === "breakEven" && Array.isArray(points) && currentPrice) {
    // 針對損益兩平點特別計算
    const diffs = points
      .filter((p) => p !== Infinity)
      .map((p) => {
        const diff = p - currentPrice;
        const percent = (diff / currentPrice) * 100;
        return { diff, percent };
      });
    if (diffs.length > 0) {
      distanceText = diffs
        .map((d) => {
          const sign = d.diff > 0 ? "+" : "";
          return `${sign}${Math.round(d.diff)} (${sign}${d.percent.toFixed(
            2
          )}%)`;
        })
        .join(" / ");
    }
  }

  const subContent = subText
    ? subText
    : type === "breakEven"
    ? "指數點位"
    : type === "ratio"
    ? "虧損 : 獲利"
    : type === "margin"
    ? "預估保證金"
    : displayMoney;

  const subPointContent =
    subPoints && subPoints.length > 0 && !isInf
      ? `@ ${subPoints.map((p) => Math.round(p)).join(" / ")}`
      : null;

  return (
    <div
      className={`p-4 rounded-xl border shadow-sm ${bgClass} flex flex-col justify-between transition-all duration-200 hover:shadow-md hover:-translate-y-1`}
    >
      <div className="flex items-center space-x-2 mb-2">
        {icon}
        <span className="text-xs font-bold text-slate-500 uppercase">
          {title}
        </span>
      </div>
      <div>
        <div
          className={`font-bold font-mono ${colorClass} ${
            type === "breakEven"
              ? "text-base sm:text-lg whitespace-normal leading-tight break-words" // 損平點：字縮小、可換行
              : "text-xl truncate" // 其他：維持大字、單行截斷
          }`}
        >
          {type === "ratio" ? points : mainContent}
        </div>

        <div className="flex flex-col">
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono break-words whitespace-normal leading-relaxed">
            {subContent}
          </div>
          {subPointContent && (
            <div
              className={`text-xs mt-1 font-mono font-bold ${
                type === "profit" ? "text-rose-400" : "text-emerald-400"
              }`}
            >
              {subPointContent}
            </div>
          )}
          {/* 新增：距離現價提示 */}
          {distanceText && (
            <div className="text-[10px] mt-1 font-medium text-slate-400 dark:text-slate-500 flex items-center">
              <MousePointerClick className="w-3 h-3 mr-1" />
              距現價: {distanceText}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Modal Component ---
const StrategyDetailsModal = ({ isOpen, onClose, strategy }) => {
  if (!isOpen || !strategy) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-200">
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                {strategy.name}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {strategy.description}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full text-slate-500 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {strategy.details && (
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-100 dark:border-blue-800">
                <h4 className="text-sm font-bold text-blue-700 dark:text-blue-300 mb-2 flex items-center">
                  <Target className="w-4 h-4 mr-2" /> 適用時機
                </h4>
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  {strategy.details.when}
                </p>
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2 flex items-center">
                  <BookOpen className="w-4 h-4 mr-2 text-slate-500" /> 策略特點
                </h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-slate-600 dark:text-slate-300 pl-1">
                  {strategy.details.features.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-rose-50 dark:bg-rose-900/10 p-3 rounded-lg border border-rose-100 dark:border-rose-800">
                  <h4 className="text-xs font-bold text-rose-700 dark:text-rose-400 mb-2 uppercase flex items-center">
                    <ThumbsUp className="w-3 h-3 mr-1" /> 優勢 (Pros)
                  </h4>
                  <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                    {strategy.details.pros.map((item, i) => (
                      <li key={i} className="flex items-start">
                        <span className="mr-1.5 text-rose-500">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-900/10 p-3 rounded-lg border border-emerald-100 dark:border-emerald-800">
                  <h4 className="text-xs font-bold text-emerald-700 dark:text-emerald-400 mb-2 uppercase flex items-center">
                    <ThumbsDown className="w-3 h-3 mr-1" /> 劣勢 (Cons)
                  </h4>
                  <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                    {strategy.details.cons.map((item, i) => (
                      <li key={i} className="flex items-start">
                        <span className="mr-1.5 text-emerald-500">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex justify-end rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-white text-sm font-medium rounded-lg transition-colors"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
};

// --- 新增：即時部位監控與評價表 ---
const RealTimeAnalysisTable = ({ legs, currentPrice, riskFreeRate, vix }) => {
  if (!legs || legs.length === 0) return null;

  // 1. 數據處理與排序
  const analyzedLegs = legs
    .map((leg) => {
      const hours = calculateRemainingHours(leg.expiryCode);
      const days = hours / 19; // 轉換為 BS Model 用的天數
      const T = Math.max(days, 0.001) / 365;
      const r = riskFreeRate / 100;
      const sigma = vix / 100;

      // 理論價 (Theoretical Price)
      const theoPrice = calculateBSPrice(
        currentPrice,
        leg.strike,
        T,
        r,
        sigma,
        leg.type
      );

      // 內含價值 (Intrinsic Value)
      const intrinsic =
        leg.type === "call"
          ? Math.max(0, currentPrice - leg.strike)
          : Math.max(0, leg.strike - currentPrice);

      // 時間價值 (Time Value)
      const timeValue = Math.max(0, theoPrice - intrinsic);

      // 損益計算 (T+0 理論損益)
      const settlementPrice = days <= 0 ? intrinsic : theoPrice;
      const unitPnL =
        (settlementPrice - leg.premium) * (leg.action === "buy" ? 1 : -1);
      const totalLegPnL = unitPnL * leg.quantity * MULTIPLIER;

      // Greeks 計算
      const greeks = calculateOptionGreeks(
        currentPrice,
        leg.strike,
        T,
        r,
        sigma,
        leg.type
      );

      // 權利金偏離率 (用於評估貴賤)
      const premiumDeviation =
        theoPrice > 0 ? (leg.premium - theoPrice) / theoPrice : 0;

      return {
        ...leg,
        hours,
        days,
        theoPrice,
        intrinsic,
        timeValue,
        unitPnL,
        totalLegPnL,
        premiumDeviation,
        greeks,
      };
    })
    .sort((a, b) => {
      // 排序順序 1：合約到期日 (由近到遠)
      if (a.days !== b.days) return a.days - b.days;

      // 排序順序 2：履約價 (由小到大)
      const strikeA = safeFloat(a.strike);
      const strikeB = safeFloat(b.strike);
      if (strikeA !== strikeB) return strikeA - strikeB;

      // 排序順序 3：類型 (先 Call 後 Put)
      if (a.type !== b.type) return a.type === "call" ? -1 : 1;

      return 0;
    });

  // 2. 總計 Greeks 與 總損益
  let totalDelta = 0,
    totalGamma = 0,
    totalVega = 0,
    totalTheta = 0;
  let totalMarketValue = 0;

  analyzedLegs.forEach((row) => {
    const direction = row.action === "buy" ? 1 : -1;
    const q = row.quantity;
    totalDelta += row.greeks.delta * direction * q;
    totalGamma += row.greeks.gamma * direction * q;
    totalVega += row.greeks.vega * direction * q;
    totalTheta += row.greeks.theta * direction * q;
    totalMarketValue += row.totalLegPnL;
  });

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl p-5 shadow-sm border border-slate-200 dark:border-slate-700 mt-4 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800 dark:text-white flex items-center">
          <Activity className="w-5 h-5 mr-2 text-rose-500" />
          即時部位監控 (已依到期日/履約價排序)
        </h3>
        <div
          className={`text-lg font-mono font-bold ${
            totalMarketValue >= 0 ? "text-rose-600" : "text-emerald-600"
          }`}
        >
          總損益: {formatCurrency(totalMarketValue)}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300 whitespace-nowrap">
          <thead className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold uppercase">
            <tr>
              <th className="p-3">合約</th>
              <th className="p-3">天數</th>
              <th className="p-3 text-right">成本/市價</th>
              <th className="p-3 text-right">理論價 (BS)</th>
              <th className="p-3 text-right">內含價值</th>
              <th className="p-3 text-right">時間價值</th>
              <th className="p-3 text-center">評價分析</th>
              <th className="p-3 text-right">單口損益</th>
              <th className="p-3 text-right">總損益 (T+0)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {analyzedLegs.map((row) => (
              <tr
                key={row.id}
                className="hover:bg-slate-50 dark:hover:bg-slate-700/50"
              >
                <td className="p-3 font-medium">
                  <span
                    className={`inline-block px-1.5 rounded mr-1 ${
                      row.action === "buy"
                        ? "bg-rose-100 text-rose-700"
                        : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {row.action === "buy" ? "B" : "S"}
                  </span>
                  {row.expiryCode} {row.strike} {row.type.toUpperCase()}
                  <span className="text-slate-400 ml-1">x{row.quantity}</span>
                </td>
                <td className="p-3">
                  {row.hours <= 0 ? (
                    <span className="text-slate-400 font-bold">已結算</span>
                  ) : (
                    `${row.hours.toFixed(1)}hr`
                  )}
                </td>
                <td className="p-3 text-right font-mono">{row.premium}</td>
                <td className="p-3 text-right font-mono text-blue-600 dark:text-blue-400">
                  {row.theoPrice.toFixed(1)}
                </td>
                <td className="p-3 text-right font-mono text-slate-400">
                  {row.intrinsic.toFixed(1)}
                </td>
                <td className="p-3 text-right font-mono">
                  {row.timeValue.toFixed(1)}
                  <div className="text-[10px] text-slate-400">
                    Theta: {(row.greeks.theta * row.quantity).toFixed(1)}/天
                  </div>
                </td>
                <td className="p-3 text-center">
                  {row.days > 0 ? (
                    row.premiumDeviation > 0.1 ? (
                      <span
                        className="text-emerald-500 font-bold"
                        title="市價(成本)高於理論價"
                      >
                        昂貴 (+{(row.premiumDeviation * 100).toFixed(0)}%)
                      </span>
                    ) : row.premiumDeviation < -0.1 ? (
                      <span
                        className="text-rose-500 font-bold"
                        title="市價(成本)低於理論價"
                      >
                        便宜 ({(row.premiumDeviation * 100).toFixed(0)}%)
                      </span>
                    ) : (
                      <span className="text-slate-400">合理</span>
                    )
                  ) : (
                    "-"
                  )}
                </td>
                <td
                  className={`p-3 text-right font-bold ${
                    row.unitPnL >= 0 ? "text-rose-500" : "text-emerald-500"
                  }`}
                >
                  {row.unitPnL.toFixed(1)}
                </td>
                <td
                  className={`p-3 text-right font-bold ${
                    row.totalLegPnL >= 0 ? "text-rose-600" : "text-emerald-600"
                  }`}
                >
                  {formatCurrency(row.totalLegPnL)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 dark:bg-slate-700/30 font-bold border-t border-slate-300 dark:border-slate-600">
            <tr>
              <td colSpan={5} className="p-3 text-right">
                投組 Greeks 總計:
              </td>
              <td colSpan={4} className="p-3">
                <div className="flex gap-4 text-xs font-mono justify-end">
                  <span
                    title="Delta"
                    className={
                      totalDelta > 0 ? "text-rose-500" : "text-emerald-500"
                    }
                  >
                    Δ {totalDelta.toFixed(2)}
                  </span>
                  <span title="Gamma" className="text-blue-500">
                    Γ {totalGamma.toFixed(4)}
                  </span>
                  <span title="Vega" className="text-purple-500">
                    ν {totalVega.toFixed(1)}
                  </span>
                  <span
                    title="Theta"
                    className={
                      totalTheta > 0 ? "text-rose-500" : "text-emerald-500"
                    }
                  >
                    θ {totalTheta.toFixed(1)}
                  </span>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

// --- 修正：AI Evaluation & Greeks Dashboard (整合 Greeks 數據與詳細說明) ---
const AIEvaluationAndGreeks = ({
  results,
  strategyId,
  inputs,
  tradingDays,
  amplitude,
}) => {
  // Calculate Portfolio Greeks
  const portfolioGreeks = useMemo(() => {
    const activeStrategy = strategies[strategyId];
    if (!activeStrategy || !activeStrategy.getLegs) return null;

    const legs = activeStrategy.getLegs(inputs);
    const S = safeFloat(inputs.currentPrice);
    const r = safeFloat(inputs.riskFreeRate) / 100;
    const sigma = safeFloat(inputs.vix) / 100;
    const T = tradingDays / 365;

    let totalGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };

    legs.forEach((leg) => {
      const K = safeFloat(leg.strike);
      const greeks = calculateOptionGreeks(S, K, T, r, sigma, leg.type);
      const multiplier = leg.action === "buy" ? 1 : -1;

      totalGreeks.delta += greeks.delta * multiplier;
      totalGreeks.gamma += greeks.gamma * multiplier;
      totalGreeks.theta += greeks.theta * multiplier;
      totalGreeks.vega += greeks.vega * multiplier;
    });

    return totalGreeks;
  }, [strategyId, inputs, tradingDays]);

  // 修正：AI 診斷邏輯納入 Greeks
  const evaluate = () => {
    const p = safeFloat(results.maxProfitPoints);
    const l = safeFloat(results.maxLossPoints);
    const hasUnlimitedRisk = l === Infinity;
    const ratio = hasUnlimitedRisk || l === 0 ? 0 : p / l;
    let score = 70;
    let verdict = "普通";
    let advice = "";
    let color = "text-amber-500";

    // 1. 損益比與風險評估
    if (hasUnlimitedRisk) {
      score -= 25;
      advice += "⚠️ 風險無限：極端行情下可能導致巨額虧損。";
      verdict = "高風險";
      color = "text-emerald-600";
    } else {
      score += 10;
      advice += "✅ 風險有限：最大虧損已鎖定。";
    }

    if (!hasUnlimitedRisk && p !== Infinity) {
      if (ratio >= 3) {
        score += 15;
        verdict = "極佳";
        advice += " 💰 賠率極佳(1賠3以上)。";
        color = "text-rose-600";
      } else if (ratio >= 1.5) {
        score += 5;
        verdict = "良好";
        advice += " 👍 賠率良好。";
        color = "text-rose-500";
      } else if (ratio < 0.5) {
        score -= 10;
        verdict = "不推薦";
        advice += " 🛑 賠率過低。";
        color = "text-emerald-500";
      }
    }

    // 2. Greeks 整合評估
    if (portfolioGreeks) {
      // Delta (方向性)
      if (strategies[strategyId].group === "波動率/中性") {
        if (Math.abs(portfolioGreeks.delta) < 0.15) {
          score += 5;
          advice += " ⚖️ Delta 趨近中性，符合策略目標。";
        } else {
          advice += " ⚠️ 部位稍有方向性偏移 (Delta≠0)。";
        }
      }

      // Theta (時間價值)
      if (portfolioGreeks.theta > 0) {
        score += 5;
        advice += " ⏳ 時間是你的朋友 (正 Theta)，每天收取時間價值。";
      } else if (portfolioGreeks.theta < 0) {
        advice += " ⏳ 需對抗時間流逝 (負 Theta)，若行情不動將虧損。";
      }

      // Vega (波動率)
      if (inputs.vix < 13 && portfolioGreeks.vega > 0) {
        score += 5;
        advice += " 🌊 目前 VIX 低檔，買方 (正 Vega) 有利於波動放大。";
      }
    }

    score = Math.max(0, Math.min(100, score));
    return { score, verdict, advice, color };
  };

  const evalResult = evaluate();

  // Greeks 解說定義
  const greekInfo = {
    Delta: {
      desc: "標的漲1點，權利金漲跌點數",
      meaning: "方向風險 / 避險比率",
    },
    Gamma: {
      desc: "標的漲1點，Delta 的變化量",
      meaning: "Delta 的加速度 / 風險",
    },
    Theta: { desc: "時間過一天，權利金減少點數", meaning: "時間價值的流逝" },
    Vega: { desc: "波動率升1%，權利金變化點數", meaning: "對波動率的敏感度" },
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
      {/* AI Diagnosis */}
      <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-slate-800 dark:to-slate-800/50 rounded-xl p-5 border border-indigo-100 dark:border-slate-700 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="bg-indigo-600 p-1.5 rounded-lg text-white">
            <Brain className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-white">
            AI 交易診斷
          </h3>
        </div>
        <div className="flex flex-row gap-4">
          <div className="relative w-16 h-16 flex-shrink-0 flex items-center justify-center bg-white dark:bg-slate-700 rounded-full shadow-inner border-4 border-indigo-100 dark:border-slate-600">
            <span className={`text-xl font-black ${evalResult.color}`}>
              {evalResult.score}
            </span>
          </div>
          <div className="flex flex-col justify-center">
            <div className={`text-lg font-bold ${evalResult.color}`}>
              {evalResult.verdict}
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mt-1">
              {evalResult.advice}
            </div>
          </div>
        </div>
      </div>

      {/* Greeks Dashboard (Updated with tooltips) */}
      <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="bg-teal-600 p-1.5 rounded-lg text-white">
            <Sigma className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-800 dark:text-white">
            風險係數儀表板 (Greeks)
          </h3>
        </div>
        {portfolioGreeks ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { name: "Delta", val: portfolioGreeks.delta, unit: "" },
              { name: "Gamma", val: portfolioGreeks.gamma, unit: "" },
              {
                name: "Theta",
                val: portfolioGreeks.theta,
                unit: "/天",
                isMoney: true,
              },
              { name: "Vega", val: portfolioGreeks.vega, unit: "/%" },
            ].map((g, i) => (
              <div
                key={i}
                className="group relative bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-600 hover:border-blue-300 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">
                    {g.name}
                  </div>
                  <HelpCircle className="w-3 h-3 text-slate-300 cursor-help" />
                </div>
                <div
                  className={`text-sm font-mono font-bold ${
                    g.val > 0.001
                      ? "text-rose-500"
                      : g.val < -0.001
                      ? "text-emerald-500"
                      : "text-slate-400"
                  }`}
                >
                  {g.val > 0 ? "+" : ""}
                  {g.val.toFixed(4)}{" "}
                  <span className="text-[10px] text-slate-400 font-normal">
                    {g.unit}
                  </span>
                </div>
                {g.isMoney && (
                  <div className="text-[10px] text-slate-400 mt-1">
                    {formatCurrency(g.val * MULTIPLIER)}/天
                  </div>
                )}

                {/* Tooltip */}
                <div className="absolute bottom-full left-0 mb-2 w-40 bg-slate-800 text-white text-xs rounded p-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
                  <div className="font-bold text-blue-300 mb-1">
                    {greekInfo[g.name].meaning}
                  </div>
                  <div>{greekInfo[g.name].desc}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-400 text-center py-4">
            無法計算 Greeks
          </div>
        )}
      </div>
    </div>
  );
};

// --- Chat Assistant Component ---
const AIChatAssistant = ({ onSelectStrategy }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "你好！我是你的交易策略助手。告訴我你對行情的看法（例如：看大漲、盤整、波動變大），我來幫你推薦策略！",
    },
  ]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isOpen]);

  const handleSend = () => {
    if (!input.trim()) return;

    // Add user message
    const userMsg = { role: "user", text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    // Simulate AI Response logic
    setTimeout(() => {
      let responseText = "";
      let suggestedStrategies = [];
      const lowerInput = input.toLowerCase();

      if (lowerInput.includes("大漲") || lowerInput.includes("噴出")) {
        responseText =
          "預期行情「大漲」，建議使用買方策略以獲取無限獲利潛力，或使用多頭價差降低成本。";
        suggestedStrategies = ["longCall", "bullCallSpread"];
      } else if (
        lowerInput.includes("大跌") ||
        lowerInput.includes("崩盤") ||
        lowerInput.includes("暴跌")
      ) {
        responseText =
          "預期行情「大跌」，建議買進賣權 (Long Put) 作為避險或投機，或使用空頭價差。";
        suggestedStrategies = ["longPut", "bearPutSpread"];
      } else if (
        lowerInput.includes("盤整") ||
        lowerInput.includes("不變") ||
        lowerInput.includes("區間") ||
        lowerInput.includes("整理")
      ) {
        responseText =
          "如果預期是「區間盤整」，鐵兀鷹 (Iron Condor) 或鐵蝴蝶 (Iron Butterfly) 是賺取時間價值的首選。";
        suggestedStrategies = ["ironCondor", "ironButterfly"];
      } else if (lowerInput.includes("緩漲") || lowerInput.includes("慢慢漲")) {
        responseText =
          "預期「緩漲」，可以考慮賣出賣權 (Short Put) 收租，或使用多頭價差 (Bull Put Spread) 比較安全。";
        suggestedStrategies = ["shortPut", "bullPutSpread"];
      } else if (lowerInput.includes("緩跌") || lowerInput.includes("漲不動")) {
        responseText =
          "預期「緩跌」或漲不動，可以考慮賣出買權 (Short Call) 收租，或使用空頭價差 (Bear Call Spread)。";
        suggestedStrategies = ["shortCall", "bearCallSpread"];
      } else if (
        lowerInput.includes("波動") ||
        lowerInput.includes("大行情") ||
        lowerInput.includes("方向不明")
      ) {
        responseText =
          "預期會有「大波動」但方向不明（例如選前或法說會），跨式 (Straddle) 或勒式 (Strangle) 策略最適合捕捉雙向爆發。";
        suggestedStrategies = ["longStraddle", "longStrangle"];
      } else {
        responseText =
          "我不確定你的意思。試試看說：「我覺得會大漲」、「最近在盤整」或「波動會變大」。";
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: responseText,
          suggestions: suggestedStrategies,
        },
      ]);
    }, 600);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 right-6 p-4 rounded-full shadow-2xl z-40 transition-all duration-300 hover:scale-110 ${
          isOpen ? "bg-rose-500 rotate-90" : "bg-blue-600 hover:bg-blue-500"
        }`}
      >
        {isOpen ? (
          <X className="text-white w-6 h-6" />
        ) : (
          <MessageSquare className="text-white w-6 h-6" />
        )}
      </button>

      <div
        className={`fixed bottom-24 right-6 w-80 sm:w-96 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-40 flex flex-col transition-all duration-300 origin-bottom-right ${
          isOpen
            ? "scale-100 opacity-100"
            : "scale-0 opacity-0 pointer-events-none"
        }`}
        style={{ height: "500px", maxHeight: "80vh" }}
      >
        <div className="p-4 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-t-2xl flex items-center text-white">
          <Bot className="w-6 h-6 mr-2" />
          <h3 className="font-bold">AI 策略助手</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-900/50">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex flex-col ${
                msg.role === "user" ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`px-4 py-2 rounded-2xl max-w-[85%] text-sm ${
                  msg.role === "user"
                    ? "bg-blue-500 text-white rounded-tr-none"
                    : "bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-100 dark:border-slate-600 rounded-tl-none shadow-sm"
                }`}
              >
                {msg.text}
              </div>
              {msg.suggestions && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {msg.suggestions.map((id) => (
                    <button
                      key={id}
                      onClick={() => {
                        onSelectStrategy(id);
                      }}
                      className="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-3 py-1 rounded-full hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition-colors border border-indigo-200 dark:border-indigo-800"
                    >
                      試試 {strategies[id]?.name.split("(")[0]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        <div className="p-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-b-2xl">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="輸入你的看法..."
              className="flex-1 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white px-4 py-2 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleSend}
              className="p-2 bg-blue-600 rounded-full text-white hover:bg-blue-700 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default function App() {
  const [selectedStrategyId, setSelectedStrategyId] = useState(
    () => localStorage.getItem("txo_strategy_id") || "ironCondor"
  );
  const [expiryDate, setExpiryDate] = useState(
    () => localStorage.getItem("txo_expiry") || getDefaultExpiryDate()
  );
  const [inputs, setInputs] = useState(() => {
    const savedInputs = localStorage.getItem("txo_inputs");
    return savedInputs ? JSON.parse(savedInputs) : DEFAULT_INPUTS;
  });

  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [chartOrientation, setChartOrientation] = useState("vertical");
  const [isUpdating, setIsUpdating] = useState(false);

  const [filterExpiry, setFilterExpiry] = useState("ALL");

  const [timeTick, setTimeTick] = useState(0);

  // === Helper 判斷目前的策略是否屬於自訂/模擬類型 ===
  const isCustomType = [
    "custom",
    "simulationA",
    "simulationB",
    "simulationC",
  ].includes(selectedStrategyId);

  // === 取得當前策略對應的資料欄位 Key ===
  const activeLegsKey =
    selectedStrategyId === "simulationA"
      ? "simulationALegs"
      : selectedStrategyId === "simulationB"
      ? "simulationBLegs"
      : selectedStrategyId === "simulationC"
      ? "simulationCLegs"
      : "customLegs";

  // 1. 取得所有不重複的到期日列表 (用於產生頁籤按鈕)
  // 依照「實際到期日」排序，而非純文字排序
  const availableExpiries = useMemo(() => {
    // 修改：判斷條件改用 isCustomType，並使用動態 Key
    if (!isCustomType || !inputs[activeLegsKey]) return [];

    const codes = [
      ...new Set(inputs[activeLegsKey].map((leg) => leg.expiryCode)),
    ].filter(Boolean);

    // 使用 getDaysUntilExpiry 進行數值排序 (天數越小越前面)
    return codes.sort((a, b) => {
      const daysA = getDaysUntilExpiry(a);
      const daysB = getDaysUntilExpiry(b);
      // 如果天數相同，則回歸文字排序
      if (Math.abs(daysA - daysB) < 0.1) return a.localeCompare(b);
      return daysA - daysB;
    });
  }, [inputs, selectedStrategyId, isCustomType, activeLegsKey]);

  // 2. 產生「實際參與運算」的 inputs (根據過濾器篩選)
  const activeInputs = useMemo(() => {
    // 修改：判斷條件
    if (!isCustomType || filterExpiry === "ALL") {
      return inputs;
    }
    // 修改：動態過濾對應的欄位
    return {
      ...inputs,
      [activeLegsKey]: inputs[activeLegsKey].filter(
        (leg) => leg.expiryCode === filterExpiry
      ),
    };
  }, [inputs, selectedStrategyId, filterExpiry, isCustomType, activeLegsKey]);

  // 當切換策略時，重置過濾器為 ALL
  useEffect(() => {
    setFilterExpiry("ALL");
  }, [selectedStrategyId]);

  const [benchmarkData, setBenchmarkData] = useState(null);
  const mainContainerRef = useRef(null);

  const activeStrategy = strategies[selectedStrategyId];

  // 用小時計算
  const remainingHours = useMemo(() => {
    // 如果是有篩選特定合約，以此為準，否則用全域 expiryDate
    if (isCustomType && filterExpiry !== "ALL") {
      return calculateRemainingHours(filterExpiry);
    }
    return calculateRemainingHours(expiryDate);
  }, [
    expiryDate,
    selectedStrategyId,
    filterExpiry,
    inputs.currentPrice,
    isCustomType,
    timeTick,
  ]);

  // 為了相容原本 Greeks 計算 (原本是用 tradingDays / 365)
  // 我們需要一個 "tradingDays" 給 Greeks 用
  // 邏輯：總時數 / 19小時 = 剩餘交易日 (Trading Days)
  // 這樣帶入 BS Model 才會準確反映「時數」的流逝
  const tradingDays = remainingHours / 19;

  useEffect(() => {
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    script.async = true;
    document.body.appendChild(script);
    return () => document.body.removeChild(script);
  }, []);

  useEffect(
    () => localStorage.setItem("txo_strategy_id", selectedStrategyId),
    [selectedStrategyId]
  );
  useEffect(() => localStorage.setItem("txo_expiry", expiryDate), [expiryDate]);
  useEffect(
    () => localStorage.setItem("txo_inputs", JSON.stringify(inputs)),
    [inputs]
  );

  // --- 智慧平移功能 (確保不影響 customLegs 及模擬部位) ---
  const updateMarketData = async (isFullUpdate) => {
    if (isFullUpdate) {
      if (
        !window.confirm(
          "確定要抓取最新行情？\n\n系統將會：\n1. 更新大盤指數、VIX 與 無風險利率\n2. 依照「漲跌幅」自動平移您目前所有的策略履約價\n(您的「自組部位監控」清單不會被更動)"
        )
      )
        return;
    }

    setIsUpdating(true);
    try {
      const response = await fetch(`${GAS_API_URL}?t=${new Date().getTime()}`);
      const data = await response.json();

      if (data.status === "success") {
        const marketPrice = safeFloat(data.price);
        const marketVix = safeFloat(data.vix);
        const marketRate =
          data.meta && data.meta.raw_rate
            ? parseFloat((safeFloat(data.meta.raw_rate) * 100).toFixed(3))
            : inputs.riskFreeRate;

        // 這裡我們保留 inputs.customLegs，確保它們不被覆蓋
        const newInputs = {
          ...inputs,
          currentPrice: marketPrice,
          vix: marketVix,
          riskFreeRate: marketRate,
        };

        if (isFullUpdate) {
          const oldPrice = safeFloat(inputs.currentPrice);
          const diffRaw = marketPrice - oldPrice;
          const diff = Math.round(diffRaw / 50) * 50;

          const strikeFields = [
            "strike",
            "lowerStrike",
            "higherStrike",
            "middleStrike",
            "putK1",
            "putK2",
            "callK3",
            "callK4",
            "lowerPutK",
            "centerStrike",
            "higherCallK",
          ];

          // 只更新標準策略的欄位，不碰 customLegs 和 simulationLegs
          strikeFields.forEach((key) => {
            if (typeof newInputs[key] === "number") {
              newInputs[key] += diff;
            }
          });

          setExpiryDate(getDefaultExpiryDate());
          alert(
            `更新成功！\n指數已更新為 ${marketPrice}\n一般策略履約價已平移 ${
              diff > 0 ? "+" : ""
            }${diff} 點。`
          );
        }
        setInputs(newInputs);
      } else {
        throw new Error("API 回傳狀態非 success");
      }
    } catch (e) {
      console.error("Update failed", e);
      alert(`行情更新失敗：${e.message || "未知錯誤"}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // ▼▼▼ 自動化功能區域 (自動更新行情 + 每分鐘倒數) ▼▼▼

  // 1. 啟動計時器：每 60 秒更新一次 timeTick，觸發畫面重算剩餘時間
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeTick((prev) => prev + 1);
    }, 60000); // 60000ms = 1分鐘
    return () => clearInterval(timer);
  }, []);

  // 2. 初始化自動化：開啟網頁時自動抓取行情 & 檢查過期
  useEffect(() => {
    const initAutomation = async () => {
      // A. 自動檢查日期是否過期
      const currentExp = new Date(expiryDate);
      currentExp.setHours(13, 45, 0, 0);
      const now = new Date();

      if (now > currentExp) {
        console.log("偵測到合約過期，自動跳轉至新合約...");
        setExpiryDate(getDefaultExpiryDate());
      }

      // B. 自動抓取最新行情 (只更新價格，不平移履約價)
      console.log("自動更新行情中...");
      await updateMarketData(false);
    };

    initAutomation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const results = useMemo(() => {
    try {
      return activeStrategy.calculate(activeInputs, activeInputs.currentPrice);
    } catch (e) {
      console.error("Calculation Error", e);
      return {
        maxProfitPoints: 0,
        maxLossPoints: 0,
        breakEven: [],
        getPnL: () => 0,
        margin: 0,
      };
    }
  }, [selectedStrategyId, activeInputs, activeStrategy]);

  // 預估振幅計算
  // 公式：指數 * 剩餘時數^(1/2) * VIX / 69.2 / 100 * 波動校正
  const amplitude = useMemo(() => {
    const cp = safeFloat(activeInputs.currentPrice, 20000);
    const vix = safeFloat(activeInputs.vix, 16);
    const correction = safeFloat(activeInputs.volCorrection, 50);

    // 使用上面算好的 remainingHours
    const hours = remainingHours;

    // 這裡的 69.2 是常數 (sqrt(19 * 252))
    const ampPercent =
      Math.sqrt(hours) * (vix / 69.2 / 100) * (correction / 100);
    const ampPoints = cp * ampPercent;

    return { points: ampPoints, percent: ampPercent * 100 };
  }, [
    activeInputs.currentPrice,
    activeInputs.vix,
    activeInputs.volCorrection,
    remainingHours,
  ]);

  const { chartData, minPrice, maxPrice, keyPrices, pnlDomain } =
    useMemo(() => {
      const currentPrice = safeFloat(activeInputs.currentPrice, 20000);

      // --- 正確抓取自組策略的履約價 (Step 2 修改) ---
      let strikeValues = [];
      if (isCustomType) {
        // 如果是自組或模擬策略，從 activeLegsKey 提取所有不重複的履約價
        strikeValues = (activeInputs[activeLegsKey] || []).map((l) =>
          safeFloat(l.strike)
        );
      } else {
        // 如果是標準策略，維持原有的提取邏輯
        strikeValues = Object.keys(activeStrategy.inputs)
          .filter(
            (k) =>
              !activeStrategy.inputs[k].id.toLowerCase().includes("premium") &&
              (activeStrategy.inputs[k].id.toLowerCase().includes("strike") ||
                activeStrategy.inputs[k].id.match(/k\d/i) ||
                activeStrategy.inputs[k].id.match(/K$/))
          )
          .map((idx) => safeFloat(activeInputs[activeStrategy.inputs[idx].id]));
      }
      // 過濾掉 0 或無效值
      strikeValues = strikeValues.filter((v) => v > 0);

      const breakEvens = results.breakEven.filter(
        (v) => v !== Infinity && v !== -Infinity
      );

      const validPoints = [currentPrice, ...strikeValues, ...breakEvens].filter(
        (v) => v > 5000
      );
      if (validPoints.length === 0) validPoints.push(currentPrice);

      let minP = Math.min(...validPoints);
      let maxP = Math.max(...validPoints);
      let spread = maxP - minP;
      if (spread < 600) spread = 600;
      const padding = Math.min(spread * 0.4, 2000);

      const rangeMin = Math.floor((minP - padding) / 100) * 100;
      const rangeMax = Math.ceil((maxP + padding) / 100) * 100;

      const steps = 150;
      const stepSize = (rangeMax - rangeMin) / steps;
      const data = [];

      for (let i = 0; i <= steps; i++) {
        const price = Math.round(rangeMin + i * stepSize);
        const pnlPoints = results.getPnL(price);
        if (!isNaN(pnlPoints)) {
          data.push({
            price: price,
            pnlPoints: pnlPoints,
            pnlMoney: pnlPoints * MULTIPLIER,
          });
        }
      }

      let finalMinPnL = Math.min(...data.map((d) => d.pnlPoints));
      let finalMaxPnL = Math.max(...data.map((d) => d.pnlPoints));

      if (benchmarkData && benchmarkData.length > 0) {
        data.forEach((d) => {
          const benchPoint = benchmarkData.find(
            (b) => Math.abs(b.price - d.price) < stepSize / 2
          );
          if (benchPoint) d.benchmarkPnL = benchPoint.pnlPoints;
        });
        const benchPnLs = benchmarkData.map((d) => d.pnlPoints);
        finalMinPnL = Math.min(finalMinPnL, ...benchPnLs);
        finalMaxPnL = Math.max(finalMaxPnL, ...benchPnLs);
      }

      // 重新計算最大獲利/虧損的發生點位 (用於畫線)
      const profitStrikes =
        results.maxProfitPoints !== Infinity
          ? strikeValues.filter(
              (k) => Math.abs(results.getPnL(k) - results.maxProfitPoints) < 1
            )
          : [];

      const lossStrikes =
        results.maxLossPoints !== Infinity
          ? strikeValues.filter(
              (k) => Math.abs(results.getPnL(k) + results.maxLossPoints) < 1
            )
          : [];

      return {
        chartData: data,
        minPrice: rangeMin,
        maxPrice: rangeMax,
        keyPrices: {
          current: currentPrice,
          strikes: [...new Set(strikeValues)],
          breakEvens: breakEvens,
          profitStrikes: [...new Set(profitStrikes)],
          lossStrikes: [...new Set(lossStrikes)],
        },
        pnlDomain: [finalMinPnL, finalMaxPnL],
      };
    }, [
      results,
      activeInputs,
      activeStrategy,
      benchmarkData,
      isCustomType,
      activeLegsKey,
    ]); // 更新依賴

  const handleSetBenchmark = () => {
    setBenchmarkData(
      chartData.map((d) => ({ price: d.price, pnlPoints: d.pnlPoints }))
    );
  };

  const handleClearBenchmark = () => {
    setBenchmarkData(null);
  };

  // 修正 V2：Snapshot 極致優化 (針對 Input 欄位文字被切斷的終極解法)
  const handleSnapshot = () => {
    if (window.html2canvas && mainContainerRef.current) {
      const originalScrollY = window.scrollY;
      window.scrollTo(0, 0); // 避免偏移

      window
        .html2canvas(mainContainerRef.current, {
          backgroundColor: document.documentElement.classList.contains("dark")
            ? "#0f172a"
            : "#f8fafc",
          scale: 2,
          useCORS: true,

          // 使用 onclone 對截圖前的 DOM 進行「整形」
          onclone: (clonedDoc) => {
            const clonedBody = clonedDoc.body;

            // 1. 【通用修復】針對所有被截斷的文字
            const truncatedElements = clonedBody.querySelectorAll(".truncate");
            truncatedElements.forEach((el) => {
              el.style.overflow = "visible";
              el.style.textOverflow = "clip";
              el.style.whiteSpace = "normal";
            });

            // 2. 【Input 專屬修復】偷天換日法
            // 原因：html2canvas 渲染 input 時，垂直對齊容易跑掉導致切字。
            // 解法：將所有 input 替換成 "長得一樣的 div"，強制垂直置中。
            const inputs = clonedBody.querySelectorAll("input");
            inputs.forEach((input) => {
              const div = clonedDoc.createElement("div");

              // 複製原本的樣式類別 (保留外觀)
              div.className = input.className;
              // 填入數值
              div.textContent = input.value;

              // 強制修正樣式：使用 Flexbox 保證垂直置中
              div.style.display = "flex";
              div.style.alignItems = "center"; // 垂直置中 (關鍵)
              div.style.justifyContent = "flex-end"; // 靠右對齊 (配合原本的 text-right)
              div.style.height = "42px"; // 強制設定高度 (比原本稍高一點點以防萬一)
              div.style.paddingRight = "12px"; // 補上原本的 px-3
              div.style.overflow = "visible"; // 絕對不隱藏溢出

              // 移除可能導致衝突的樣式
              div.style.lineHeight = "normal";

              // 用這個完美的 div 取代原本的 input
              input.parentNode.replaceChild(div, input);
            });

            // 3. 【ResultCard 數字修復】
            // 排除剛剛生成的 input div，只針對原本的數據卡片
            const monoTexts = clonedBody.querySelectorAll(".font-mono");
            monoTexts.forEach((el) => {
              // 如果不是 input (且不是我們剛生成的 div)，則增加底部緩衝
              if (el.tagName !== "INPUT" && !el.style.display) {
                el.style.lineHeight = "1.5";
                el.style.paddingBottom = "5px"; // 增加底部緩衝
              }
            });
          },
        })
        .then((canvas) => {
          const link = document.createElement("a");
          const now = new Date();
          const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
          const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, ""); // HHMMSS
          link.download = `TXO_Plan_${dateStr}_${timeStr}.png`;
          link.href = canvas.toDataURL();
          link.click();
          window.scrollTo(0, originalScrollY);
        })
        .catch((err) => {
          console.error("Snapshot failed:", err);
          window.scrollTo(0, originalScrollY);
        });
    } else {
      alert("截圖功能初始化中，請稍後再試。");
    }
  };

  // --- 重置功能 ---
  const handleReset = () => {
    if (
      window.confirm(
        "⚠️ 確定要重置所有設定？\n\n這將會：\n1. 清除一般策略參數並還原至預設值。\n2. 保留您的「自組部位監控」與「模擬演練」清單。"
      )
    ) {
      // 1. 備份所有自組與模擬部位
      const savedCustomLegs = inputs.customLegs || [];
      const savedSimA = inputs.simulationALegs || [];
      const savedSimB = inputs.simulationBLegs || [];
      const savedSimC = inputs.simulationCLegs || [];

      // 2. 清除 LocalStorage
      localStorage.removeItem("txo_inputs");
      localStorage.removeItem("txo_strategy_id");
      localStorage.removeItem("txo_expiry");

      // 3. 建立新的預設值，但塞回備份的 customLegs 及模擬部位
      const newInputs = {
        ...DEFAULT_INPUTS,
        customLegs: savedCustomLegs,
        simulationALegs: savedSimA,
        simulationBLegs: savedSimB,
        simulationCLegs: savedSimC,
      };

      // 4. 更新 State
      setInputs(newInputs);
      setExpiryDate(getDefaultExpiryDate());
      setSelectedStrategyId("custom"); // 重置回預設策略

      // 5. 立即寫回 LocalStorage，避免下次重整又變成空的
      localStorage.setItem("txo_inputs", JSON.stringify(newInputs));

      alert("設定已重置 (自組與模擬部位已保留)。");
    }
  };

  const getGradientOffset = (domain) => {
    const [min, max] = domain;
    if (max <= 0) return 0;
    if (min >= 0) return 1;
    return max / (max - min);
  };
  const gradientOffset = getGradientOffset(pnlDomain);
  const verticalGradientOffset =
    (0 - pnlDomain[0]) / (pnlDomain[1] - pnlDomain[0]);

  const handleInputChange = (e) =>
    setInputs({ ...inputs, [e.target.name]: e.target.value });

  const groupedStrategies = useMemo(() => {
    return Object.values(strategies).reduce((acc, strat) => {
      if (!acc[strat.group]) acc[strat.group] = [];
      acc[strat.group].push(strat);
      return acc;
    }, {});
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-sans pb-10 transition-colors duration-200">
      <div
        ref={mainContainerRef}
        className="bg-slate-50 dark:bg-slate-900 pb-10"
      >
        {/* Header */}
        <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-30 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center justify-between w-full md:w-auto">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                  className="lg:hidden p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md"
                >
                  <Menu className="w-5 h-5" />
                </button>
                <div className="bg-blue-600 p-2 rounded text-white shadow-blue-200 dark:shadow-none shadow-sm">
                  <Activity className="h-5 w-5" />
                </div>
                <h1 className="text-base font-bold text-slate-800 dark:text-white sm:text-lg tracking-tight">
                  TXO 策略分析儀 Pro
                </h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3 overflow-x-auto pb-1 md:pb-0 scrollbar-hide">
              <div className="hidden xl:flex items-center px-3 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full text-xs font-bold border border-amber-200 dark:border-amber-800 whitespace-nowrap">
                <DollarSign className="w-3 h-3 mr-1" />
                1點 = 50元
              </div>

              <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-md px-2 py-1 border border-transparent dark:border-slate-600">
                <Calendar className="w-3 h-3 text-slate-400 mr-2" />
                <span className="text-[10px] text-slate-500 mr-1 hidden sm:inline">
                  結算
                </span>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="bg-transparent text-xs font-medium focus:outline-none text-slate-600 dark:text-slate-300 w-[88px] sm:w-auto cursor-pointer"
                />
                <div className="ml-2 pl-2 border-l border-slate-300 dark:border-slate-500 text-[10px] text-slate-500 flex items-center whitespace-nowrap">
                  <Clock className="w-3 h-3 mr-1" />剩{" "}
                  {remainingHours.toFixed(1)} 小時 ({tradingDays.toFixed(1)}天)
                </div>
              </div>

              <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-md px-2 py-1 border border-transparent dark:border-slate-600">
                <BarChart2 className="w-3 h-3 text-slate-400 mr-2" />
                <span className="text-[10px] text-slate-500 mr-1 hidden sm:inline">
                  VIX
                </span>
                <input
                  type="number"
                  name="vix"
                  step="0.01"
                  value={inputs.vix}
                  onChange={handleInputChange}
                  className="bg-transparent text-xs font-medium focus:outline-none text-slate-600 dark:text-slate-300 w-12 text-right"
                  placeholder="16"
                />
              </div>

              <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-md px-2 py-1 border border-transparent dark:border-slate-600">
                <span className="text-[10px] text-slate-500 mr-1">Rate%</span>
                <input
                  type="number"
                  step="0.001" // 允許輸入小數點後三位
                  // 這裡直接讀取 inputs.riskFreeRate，因為第一步已經修復了源頭，這裡就會顯示 1.785
                  value={inputs.riskFreeRate}
                  onChange={(e) =>
                    setInputs({ ...inputs, riskFreeRate: e.target.value })
                  }
                  onBlur={(e) => {
                    // 當使用者手動輸入並離開時，也執行一次清理，確保格式整齊
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      setInputs({ ...inputs, riskFreeRate: val.toFixed(3) });
                    }
                  }}
                  className="bg-transparent text-xs font-medium w-16 text-right focus:outline-none"
                  title="無風險利率"
                />
              </div>

              <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-md px-2 py-1 border border-transparent dark:border-slate-600">
                <button
                  onClick={() => updateMarketData(false)}
                  disabled={isUpdating}
                  className="p-1 hover:bg-slate-200 dark:hover:bg-slate-600 rounded transition-colors"
                >
                  <RefreshCw
                    className={`w-3 h-3 text-slate-400 ${
                      isUpdating ? "animate-spin text-blue-500" : ""
                    }`}
                  />
                </button>
                <input
                  type="number"
                  name="currentPrice"
                  value={inputs.currentPrice}
                  onChange={handleInputChange}
                  className="w-20 bg-transparent text-sm font-medium focus:outline-none ml-1 text-right"
                  placeholder="指數"
                />
              </div>

              <button
                onClick={() => updateMarketData(true)}
                className="p-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800 transition-colors"
                title="智慧更新(平移)"
              >
                <Zap className="w-4 h-4" />
              </button>
              <button
                onClick={handleReset}
                className="p-2 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 rounded-md hover:bg-rose-100 border border-rose-200 dark:border-rose-800 transition-colors ml-2"
                title="重置回預設值"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={handleSnapshot}
                className="p-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-md hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800"
                title="快照分享"
              >
                <Camera className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col lg:flex-row gap-6 relative">
          {isSidebarOpen && (
            <div
              className="fixed inset-0 bg-black/50 z-30 lg:hidden"
              onClick={() => setIsSidebarOpen(false)}
            />
          )}

          {/* Sidebar */}
          <nav
            className={`fixed lg:static top-0 left-0 h-full lg:h-auto w-64 bg-white dark:bg-slate-800 lg:bg-transparent shadow-xl lg:shadow-none z-40 transform lg:transform-none transition-transform duration-300 overflow-y-auto lg:overflow-visible p-4 lg:p-0 ${
              isSidebarOpen
                ? "translate-x-0"
                : "-translate-x-full lg:translate-x-0"
            }`}
          >
            <div className="flex justify-between items-center lg:hidden mb-4">
              <span className="font-bold text-lg">選擇策略</span>
              <button onClick={() => setIsSidebarOpen(false)}>
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="space-y-6">
              {Object.entries(groupedStrategies).map(([group, strats]) => (
                <div key={group}>
                  <h3 className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center">
                    <Sparkles className="w-3 h-3 mr-1 inline-block" />
                    {group}
                  </h3>
                  <div className="space-y-1">
                    {strats.map((strat) => (
                      <button
                        key={strat.id}
                        onClick={() => {
                          setSelectedStrategyId(strat.id);
                          setIsSidebarOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all duration-200 flex items-center justify-between group border ${
                          selectedStrategyId === strat.id
                            ? "bg-blue-600 text-white shadow-md border-blue-500"
                            : "bg-white dark:bg-slate-800 border-transparent hover:border-slate-200 dark:hover:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                        }`}
                      >
                        <span className="truncate font-medium">
                          {strat.name.split("(")[0]}
                        </span>
                        {selectedStrategyId === strat.id && (
                          <ChevronRight className="w-4 h-4 opacity-75" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </nav>

          {/* Main Content */}
          <main className="flex-1 space-y-4 min-w-0">
            <div className="bg-white dark:bg-slate-800 rounded-xl p-5 shadow-sm border border-slate-200 dark:border-slate-700 relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2 relative z-10">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      {activeStrategy.name}
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                      {activeStrategy.description}
                    </p>
                  </div>
                  <button
                    onClick={() => setIsDetailModalOpen(true)}
                    className="self-start px-3 py-1.5 text-xs font-medium bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors flex items-center border border-indigo-200 dark:border-indigo-800"
                  >
                    <BookOpen className="w-3 h-3 mr-1.5" />
                    策略詳解
                  </button>
                </div>
                <span
                  className={`self-start sm:self-auto px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap shadow-sm border ${
                    activeStrategy.sentiment.includes("看大漲")
                      ? "bg-rose-100 text-rose-700 border-rose-200"
                      : activeStrategy.sentiment.includes("看大跌")
                      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                      : "bg-blue-100 text-blue-700 border-blue-200"
                  }`}
                >
                  {activeStrategy.sentiment}
                </span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg border border-slate-100 dark:border-slate-700/50 relative z-10">
                {/* Step 3 修改：使用 isCustomType 判斷，並傳入動態的 activeLegsKey */}
                {isCustomType ? (
                  <CustomStrategyBuilder
                    legs={inputs[activeLegsKey] || []}
                    currentPrice={inputs.currentPrice}
                    analysisMode={inputs.analysisMode || "expiry"}
                    onModeChange={(mode) =>
                      setInputs({ ...inputs, analysisMode: mode })
                    }
                    // 動態更新對應的 Key
                    onChange={(newLegs) =>
                      setInputs({ ...inputs, [activeLegsKey]: newLegs })
                    }
                  />
                ) : (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {activeStrategy.inputs.map((field) => (
                      <InputField
                        key={field.id}
                        label={field.label}
                        name={field.id}
                        value={inputs[field.id]}
                        onChange={handleInputChange}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <AIEvaluationAndGreeks
              results={results}
              strategyId={selectedStrategyId}
              inputs={activeInputs}
              tradingDays={tradingDays}
              amplitude={amplitude}
            />

            {/* Step 3 修改：RealTimeAnalysisTable 也要根據 isCustomType 顯示 */}
            {isCustomType && (
              <RealTimeAnalysisTable
                legs={activeInputs[activeLegsKey]}
                currentPrice={safeFloat(activeInputs.currentPrice)}
                riskFreeRate={safeFloat(activeInputs.riskFreeRate)}
                vix={safeFloat(activeInputs.vix)}
              />
            )}
            {/* Step 3 修改：Filter 按鈕 */}
            {isCustomType && availableExpiries.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4 mb-2">
                <button
                  onClick={() => setFilterExpiry("ALL")}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
                    filterExpiry === "ALL"
                      ? "bg-slate-800 text-white dark:bg-white dark:text-slate-900 border-slate-800 dark:border-white shadow-md"
                      : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                  }`}
                >
                  全部合約 (Total)
                </button>
                {availableExpiries.map((code) => (
                  <button
                    key={code}
                    onClick={() => setFilterExpiry(code)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all border ${
                      filterExpiry === code
                        ? "bg-blue-600 text-white border-blue-600 shadow-md"
                        : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                    }`}
                  >
                    {code}
                  </button>
                ))}
              </div>
            )}

            {/* Stats Cards (with Distance Calculation) */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <ResultCard
                title="最大獲利"
                points={results.maxProfitPoints}
                type="profit"
                subPoints={keyPrices.profitStrikes}
                currentPrice={safeFloat(activeInputs.currentPrice)}
              />
              <ResultCard
                title="最大虧損"
                points={results.maxLossPoints}
                type="loss"
                subPoints={keyPrices.lossStrikes}
                currentPrice={safeFloat(activeInputs.currentPrice)}
              />
              <ResultCard
                title="損益兩平點"
                points={results.breakEven}
                type="breakEven"
                currentPrice={safeFloat(activeInputs.currentPrice)}
              />
              <ResultCard
                title="預估保證金"
                points={results.margin || 0}
                type="margin"
              />
              <ResultCard
                title="預估振幅"
                points={amplitude.points}
                type="volatility"
                subText={`±${amplitude.percent.toFixed(2)}%`}
              />
              <ResultCard
                title="賠率 (風險報酬比)"
                points={
                  results.maxProfitPoints === Infinity
                    ? "利潤無限"
                    : results.maxLossPoints === Infinity
                    ? "風險無限"
                    : `1 : ${(
                        results.maxProfitPoints / results.maxLossPoints
                      ).toFixed(2)}`
                }
                type="ratio"
              />
            </div>

            {/* Chart Section */}
            <div className="bg-white dark:bg-slate-800 rounded-xl p-5 shadow-sm border border-slate-200 dark:border-slate-700 min-h-[550px]">
              <div className="flex flex-col sm:flex-row items-center justify-between mb-6">
                <div className="flex flex-col mb-4 sm:mb-0">
                  <h3 className="font-bold text-slate-800 dark:text-white text-sm flex items-center">
                    <Activity className="w-4 h-4 mr-2 text-indigo-500" />
                    損益分佈圖
                  </h3>
                  <div className="text-[10px] text-slate-400 flex items-center gap-3 mt-1">
                    <span className="flex items-center">
                      <div className="w-2 h-2 rounded-full bg-rose-500 mr-1"></div>{" "}
                      獲利區間
                    </span>
                    <span className="flex items-center">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 mr-1"></div>{" "}
                      虧損區間
                    </span>
                    {benchmarkData && (
                      <span className="flex items-center">
                        <div className="w-4 h-0.5 bg-slate-400 border-t border-dashed border-slate-400 mr-1"></div>
                        比較基準
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <div className="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-lg">
                    <button
                      onClick={handleSetBenchmark}
                      className="flex items-center px-2 py-1.5 text-xs font-medium rounded-md hover:bg-white dark:hover:bg-slate-600 text-slate-500 hover:shadow-sm transition-all"
                      title="將當前曲線設為比較基準"
                    >
                      <Layers className="w-3 h-3 mr-1" />
                      設為基準
                    </button>
                    {benchmarkData && (
                      <button
                        onClick={handleClearBenchmark}
                        className="flex items-center px-2 py-1.5 text-xs font-medium rounded-md hover:bg-white dark:hover:bg-slate-600 text-rose-500 hover:shadow-sm transition-all"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="flex bg-slate-100 dark:bg-slate-700 p-1 rounded-lg">
                    <button
                      onClick={() => setChartOrientation("vertical")}
                      className={`flex items-center px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                        chartOrientation === "vertical"
                          ? "bg-white dark:bg-slate-600 shadow-sm text-blue-600 dark:text-blue-300"
                          : "text-slate-500"
                      }`}
                    >
                      <Layout className="w-3 h-3 mr-1.5 rotate-90" />
                      操盤
                    </button>
                    <button
                      onClick={() => setChartOrientation("horizontal")}
                      className={`flex items-center px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                        chartOrientation === "horizontal"
                          ? "bg-white dark:bg-slate-600 shadow-sm text-blue-600 dark:text-blue-300"
                          : "text-slate-500"
                      }`}
                    >
                      <Layout className="w-3 h-3 mr-1.5" />
                      教科書
                    </button>
                  </div>
                </div>
              </div>

              <div className="h-[450px] w-full">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    {chartOrientation === "vertical" ? (
                      // Vertical Layout
                      <ComposedChart
                        layout="vertical"
                        data={chartData}
                        margin={{ top: 20, right: 30, left: 10, bottom: 20 }}
                      >
                        <defs>
                          <linearGradient
                            id="splitFillVertical"
                            x1="0"
                            y1="0"
                            x2="1"
                            y2="0"
                          >
                            <stop
                              offset="0%"
                              stopColor="#10b981"
                              stopOpacity={0.6}
                            />
                            <stop
                              offset={`${verticalGradientOffset * 100}%`}
                              stopColor="#10b981"
                              stopOpacity={0.05}
                            />
                            <stop
                              offset={`${verticalGradientOffset * 100}%`}
                              stopColor="#f43f5e"
                              stopOpacity={0.05}
                            />
                            <stop
                              offset="100%"
                              stopColor="#f43f5e"
                              stopOpacity={0.6}
                            />
                          </linearGradient>
                          <linearGradient
                            id="splitStrokeVertical"
                            x1="0"
                            y1="0"
                            x2="1"
                            y2="0"
                          >
                            <stop
                              offset="0%"
                              stopColor="#059669"
                              stopOpacity={1}
                            />
                            <stop
                              offset={`${verticalGradientOffset * 100}%`}
                              stopColor="#059669"
                              stopOpacity={1}
                            />
                            <stop
                              offset={`${verticalGradientOffset * 100}%`}
                              stopColor="#e11d48"
                              stopOpacity={1}
                            />
                            <stop
                              offset="100%"
                              stopColor="#e11d48"
                              stopOpacity={1}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#e2e8f0"
                          opacity={0.5}
                        />
                        <XAxis
                          type="number"
                          dataKey="pnlPoints"
                          domain={pnlDomain}
                          tick={{ fontSize: 10 }}
                          stroke="#94a3b8"
                          label={{
                            value: "損益點數",
                            position: "insideBottom",
                            offset: -10,
                            fontSize: 10,
                          }}
                        />
                        <YAxis
                          type="number"
                          dataKey="price"
                          domain={[minPrice, maxPrice]}
                          tickCount={10}
                          interval="preserveStartEnd"
                          tick={{ fontSize: 11, fontWeight: "bold" }}
                          stroke="#64748b"
                          label={{
                            value: "加權指數",
                            angle: -90,
                            position: "insideLeft",
                            fontSize: 10,
                          }}
                          width={60}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const d = payload[0].payload;
                              return (
                                <div className="bg-white/95 dark:bg-slate-800/95 p-3 border border-slate-200 dark:border-slate-600 rounded shadow-lg text-sm z-50 backdrop-blur-sm">
                                  <p className="text-slate-500 mb-1">
                                    指數:{" "}
                                    <span className="font-bold text-slate-800 dark:text-white">
                                      {d.price}
                                    </span>
                                  </p>
                                  <div
                                    className={`text-lg font-bold ${
                                      d.pnlPoints >= 0
                                        ? "text-rose-600"
                                        : "text-emerald-600"
                                    }`}
                                  >
                                    {d.pnlPoints.toFixed(0)} 點
                                  </div>
                                  <div className="text-xs text-slate-400">
                                    {formatCurrency(d.pnlPoints * MULTIPLIER)}
                                  </div>
                                  {d.benchmarkPnL !== undefined && (
                                    <div className="mt-2 pt-2 border-t border-dashed border-slate-300 dark:border-slate-600">
                                      <div className="text-xs text-slate-500">
                                        基準差異:{" "}
                                        <span
                                          className={
                                            d.pnlPoints - d.benchmarkPnL > 0
                                              ? "text-rose-500"
                                              : "text-emerald-500"
                                          }
                                        >
                                          {(
                                            d.pnlPoints - d.benchmarkPnL
                                          ).toFixed(0)}{" "}
                                          點
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <ReferenceLine
                          x={0}
                          stroke="#94a3b8"
                          strokeWidth={1.5}
                          strokeDasharray="3 3"
                        />
                        <ReferenceLine
                          y={keyPrices.current}
                          stroke="#f97316"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                        >
                          <Label
                            value={`目前: ${keyPrices.current}`}
                            position="insideTopRight"
                            fill="#f97316"
                            fontSize={10}
                          />
                        </ReferenceLine>
                        {/* 修正：加入消失的標示線 (Vertical: y軸為價格) */}
                        {keyPrices.breakEvens.map((p, i) => (
                          <ReferenceLine
                            key={`be-${i}`}
                            y={p}
                            stroke="#3b82f6"
                            strokeDasharray="3 3"
                          >
                            <Label
                              value="損平"
                              position="insideLeft"
                              fill="#3b82f6"
                              fontSize={10}
                            />
                          </ReferenceLine>
                        ))}
                        {keyPrices.profitStrikes.map((p, i) => (
                          <ReferenceLine
                            key={`prof-${i}`}
                            y={p}
                            stroke="#f43f5e"
                            strokeDasharray="2 2"
                          >
                            <Label
                              value="最大獲利"
                              position="insideRight"
                              fill="#f43f5e"
                              fontSize={10}
                            />
                          </ReferenceLine>
                        ))}
                        {keyPrices.lossStrikes.map((p, i) => (
                          <ReferenceLine
                            key={`loss-${i}`}
                            y={p}
                            stroke="#10b981"
                            strokeDasharray="2 2"
                          >
                            <Label
                              value="最大虧損"
                              position="insideRight"
                              fill="#10b981"
                              fontSize={10}
                            />
                          </ReferenceLine>
                        ))}

                        {benchmarkData && (
                          <Area
                            type="monotone"
                            dataKey="benchmarkPnL"
                            stroke="#94a3b8"
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            fill="none"
                          />
                        )}
                        <Area
                          type="monotone"
                          dataKey="pnlPoints"
                          stroke="url(#splitStrokeVertical)"
                          strokeWidth={3}
                          fill="url(#splitFillVertical)"
                          animationDuration={500}
                        />
                      </ComposedChart>
                    ) : (
                      // Horizontal Layout
                      <ComposedChart
                        data={chartData}
                        margin={{ top: 20, right: 30, left: 10, bottom: 20 }}
                      >
                        <defs>
                          <linearGradient
                            id="splitFillHorizontal"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="#f43f5e"
                              stopOpacity={0.6}
                            />
                            <stop
                              offset={`${gradientOffset * 100}%`}
                              stopColor="#f43f5e"
                              stopOpacity={0.05}
                            />
                            <stop
                              offset={`${gradientOffset * 100}%`}
                              stopColor="#10b981"
                              stopOpacity={0.05}
                            />
                            <stop
                              offset="100%"
                              stopColor="#10b981"
                              stopOpacity={0.6}
                            />
                          </linearGradient>
                          <linearGradient
                            id="splitStrokeHorizontal"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="#e11d48"
                              stopOpacity={1}
                            />
                            <stop
                              offset={`${gradientOffset * 100}%`}
                              stopColor="#e11d48"
                              stopOpacity={1}
                            />
                            <stop
                              offset={`${gradientOffset * 100}%`}
                              stopColor="#059669"
                              stopOpacity={1}
                            />
                            <stop
                              offset="100%"
                              stopColor="#059669"
                              stopOpacity={1}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#e2e8f0"
                          opacity={0.5}
                        />
                        <XAxis
                          type="number"
                          dataKey="price"
                          domain={[minPrice, maxPrice]}
                          tickCount={10}
                          interval="preserveStartEnd"
                          tick={{ fontSize: 11, fontWeight: "bold" }}
                          stroke="#64748b"
                          label={{
                            value: "加權指數",
                            position: "insideBottom",
                            offset: -10,
                            fontSize: 10,
                          }}
                        />
                        <YAxis
                          type="number"
                          dataKey="pnlPoints"
                          domain={pnlDomain}
                          tick={{ fontSize: 10 }}
                          stroke="#94a3b8"
                          label={{
                            value: "損益點數",
                            angle: -90,
                            position: "insideLeft",
                            fontSize: 10,
                          }}
                          width={60}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const d = payload[0].payload;
                              return (
                                <div className="bg-white/95 dark:bg-slate-800/95 p-3 border border-slate-200 dark:border-slate-600 rounded shadow-lg text-sm z-50 backdrop-blur-sm">
                                  <p className="text-slate-500 mb-1">
                                    指數:{" "}
                                    <span className="font-bold text-slate-800 dark:text-white">
                                      {d.price}
                                    </span>
                                  </p>
                                  <div
                                    className={`text-lg font-bold ${
                                      d.pnlPoints >= 0
                                        ? "text-rose-600"
                                        : "text-emerald-600"
                                    }`}
                                  >
                                    {d.pnlPoints.toFixed(0)} 點
                                  </div>
                                  <div className="text-xs text-slate-400">
                                    {formatCurrency(d.pnlPoints * MULTIPLIER)}
                                  </div>
                                  {d.benchmarkPnL !== undefined && (
                                    <div className="mt-2 pt-2 border-t border-dashed border-slate-300 dark:border-slate-600">
                                      <div className="text-xs text-slate-500">
                                        基準差異:{" "}
                                        <span
                                          className={
                                            d.pnlPoints - d.benchmarkPnL > 0
                                              ? "text-rose-500"
                                              : "text-emerald-500"
                                          }
                                        >
                                          {(
                                            d.pnlPoints - d.benchmarkPnL
                                          ).toFixed(0)}{" "}
                                          點
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <ReferenceLine
                          y={0}
                          stroke="#94a3b8"
                          strokeWidth={1.5}
                          strokeDasharray="3 3"
                        />
                        <ReferenceLine
                          x={keyPrices.current}
                          stroke="#f97316"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                        >
                          <Label
                            value={`目前: ${keyPrices.current}`}
                            position="insideTopRight"
                            fill="#f97316"
                            fontSize={10}
                          />
                        </ReferenceLine>

                        {/* 修正：加入消失的標示線 (Horizontal: x軸為價格) */}
                        {keyPrices.breakEvens.map((p, i) => (
                          <ReferenceLine
                            key={`be-${i}`}
                            x={p}
                            stroke="#3b82f6"
                            strokeDasharray="3 3"
                          >
                            <Label
                              value="損平"
                              position="insideTop"
                              fill="#3b82f6"
                              fontSize={10}
                            />
                          </ReferenceLine>
                        ))}
                        {keyPrices.profitStrikes.map((p, i) => (
                          <ReferenceLine
                            key={`prof-${i}`}
                            x={p}
                            stroke="#f43f5e"
                            strokeDasharray="2 2"
                          >
                            <Label
                              value="最大獲利"
                              position="insideBottom"
                              fill="#f43f5e"
                              fontSize={10}
                            />
                          </ReferenceLine>
                        ))}
                        {keyPrices.lossStrikes.map((p, i) => (
                          <ReferenceLine
                            key={`loss-${i}`}
                            x={p}
                            stroke="#10b981"
                            strokeDasharray="2 2"
                          >
                            <Label
                              value="最大虧損"
                              position="insideBottom"
                              fill="#10b981"
                              fontSize={10}
                            />
                          </ReferenceLine>
                        ))}

                        {benchmarkData && (
                          <Area
                            type="monotone"
                            dataKey="benchmarkPnL"
                            stroke="#94a3b8"
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            fill="none"
                          />
                        )}
                        <Area
                          type="monotone"
                          dataKey="pnlPoints"
                          stroke="url(#splitStrokeHorizontal)"
                          strokeWidth={3}
                          fill="url(#splitFillHorizontal)"
                          animationDuration={500}
                        />
                      </ComposedChart>
                    )}
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm">
                    <Activity className="w-10 h-10 mb-2 opacity-20" />
                    無法產生圖表，請檢查輸入數值
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>

      <StrategyDetailsModal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        strategy={activeStrategy}
      />
      <AIChatAssistant onSelectStrategy={setSelectedStrategyId} />
    </div>
  );
}
