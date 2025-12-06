// firestore.js
// Real-time Firebase interactions for the trivia game.
// public/js/firestore.js
// Expanded Firestore helpers: memory game, draft/categories, subs, scoring, intermission, realtime

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  arrayUnion,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

import { firebaseConfig } from "./firebaseConfig.js";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// ----------------- Utilities -----------------
function gameRef(gameId) {
  return doc(db, "games", gameId);
}

// ----------------- Game setup/join -----------------
export async function createGame(gameId, hostName) {
  await setDoc(gameRef(gameId), {
    host: hostName,
    phase: "lobby",
    createdAt: serverTimestamp(),
    settings: {
      memory_type: "Numbers",
      memory_units: 10,
      memorize_time: 5,
      entry_time: 8,
      main_time: 15,
      side_time: 10,
      question_values: [100,200,400,600,800,1000],
      sub_penalty: 0,
      min_sub_save: 50
    },
    players: {},         // players.{playerName} = {name, joinedAt}
    scores: {},          // scores.{playerName} = number
    draft: {
      order: [],         // list of player names in drafting order
      picks: {}          // picks.{playerName} = [cat1, cat2]
    },
    categories: {
      round1: [],        // host-provided 20
      round2_pool: [],   // top10 from intermission
    },
    memory: {
      sequence: [],
      entries: {}        // entries.{playerName} = [units]
    },
    currentQuestion: null,   // { text, answers, correctIndex, value, main, sub, timestamp }
    answers: {},             // answers.{playerName} = index
    intermission: {
      suggestions: {},  // suggestions.{playerName} = [cat...]
      votes: {}         // votes.{playerName} = [cat...]
    }
  });
}

export async function joinGame(gameId, playerName) {
  const gRef = gameRef(gameId);
  const snap = await getDoc(gRef);
  if (!snap.exists()) return { ok: false, error: "Game not found" };

  await updateDoc(gRef, {
    [`players.${playerName}`]: { joinedAt: Date.now(), name: playerName },
    [`scores.${playerName}`]: 0
  });
  return { ok: true };
}

// ----------------- Real-time listener -----------------
export function listenToGame(gameId, callback) {
  const ref = gameRef(gameId);
  return onSnapshot(ref, (snap) => {
    callback(snap.exists() ? snap.data() : null);
  });
}

// ----------------- Memory game -----------------
export async function generateMemorySequence(gameId, seqArray) {
  // seqArray: array of units generated on host (strings)
  await updateDoc(gameRef(gameId), {
    "memory.sequence": seqArray,
    "memory.entries": {}
  });
  // set phase to memory
  await updateDoc(gameRef(gameId), { phase: "memory" });
}

export async function submitMemoryEntry(gameId, playerName, entriesArray) {
  // store the player's sequence entries (could be partial)
  await updateDoc(gameRef(gameId), {
    [`memory.entries.${playerName}`]: entriesArray
  });
}

// finalize memory: compute winner = first player with full correct sequence
// if tie, earliest submission wins (we check sequence equality and order via createdAt not available, so we pick longest-correct then earliest in draft order)
export async function finalizeMemoryRound(gameId) {
  const gRef = gameRef(gameId);
  const snap = await getDoc(gRef);
  if (!snap.exists()) return;
  const game = snap.data();
  const seq = game.memory?.sequence || [];
  const entries = game.memory?.entries || {};
  // determine who completed the sequence exactly (exact order match)
  let winner = null;
  for (const [p, arr] of Object.entries(entries)) {
    if (Array.isArray(arr) && arr.length === seq.length) {
      let ok = true;
      for (let i = 0; i < seq.length; i++) {
        if ((arr[i] ?? "").toString().trim().toLowerCase() !== (seq[i] ?? "").toString().trim().toLowerCase()) {
          ok = false; break;
        }
      }
      if (ok) { winner = p; break; }
    }
  }
  // fallback: if none matched exactly, pick the player with most correct prefix (tie-breaker arbitrary)
  if (!winner) {
    let best = { p: null, correct: -1 };
    for (const [p, arr] of Object.entries(entries)) {
      let c = 0;
      for (let i = 0; i < Math.min(arr.length, seq.length); i++) {
        if ((arr[i] ?? "").toString().trim().toLowerCase() === (seq[i] ?? "").toString().trim().toLowerCase()) c++;
        else break;
      }
      if (c > best.correct) best = { p, correct: c };
    }
    winner = best.p;
  }

  // set draft order starting with winner (rotate players so winner first)
  const playersList = Object.keys(game.players || {});
  if (playersList.length) {
    let order;
    if (winner && playersList.includes(winner)) {
      const idx = playersList.indexOf(winner);
      order = playersList.slice(idx).concat(playersList.slice(0, idx));
    } else {
      order = playersList; // fallback
    }
    await updateDoc(gRef, {
      "draft.order": order,
      "draft.picks": {}
    });
  }

  // clear memory sequence (optional) and set phase to draft
  await updateDoc(gRef, { "memory.sequence": [], phase: "draft" });

  return winner;
}

// ----------------- Draft / Category picks -----------------
export async function pickCategory(gameId, playerName, category) {
  // add category to player's picks (max 2)
  await runTransaction(db, async (tx) => {
    const gSnap = await tx.get(gameRef(gameId));
    if (!gSnap.exists()) throw "Game not found";
    const data = gSnap.data();
    const picks = (data.draft?.picks) || {};
    const cur = picks[playerName] || [];
    if (cur.length >= 2) throw "Already picked 2 categories";
    cur.push(category);
    tx.update(gameRef(gameId), { [`draft.picks.${playerName}`]: cur });
  });
}

// ----------------- Question / Answer flow -----------------
export async function hostSubmitQuestion(gameId, questionText, answersArray, correctIndex, value, mainPlayer) {
  await updateDoc(gameRef(gameId), {
    currentQuestion: {
      text: questionText,
      answers: answersArray,
      correctIndex: correctIndex,
      value: value,
      main: mainPlayer || null,
      sub: null,
      ts: Date.now()
    },
    answers: {},            // reset answers
    phase: "question"
  });
}

export async function setSubForCurrent(gameId, subPlayerName) {
  await updateDoc(gameRef(gameId), {
    "currentQuestion.sub": subPlayerName
  });
}

// player submits answer (index or free text)
export async function submitAnswer(gameId, playerName, answerIndexOrText) {
  await updateDoc(gameRef(gameId), {
    [`answers.${playerName}`]: answerIndexOrText
  });
}

// ----------------- SCORING ENGINE -----------------
/*
 Scoring rules implemented here:
 - If main correct => main gets full value
    - sides correct each get +50
    - sub (if correct) gets 100 instead of 50
 - If main wrong & sub correct => main gets 1/2 V, sub gets 1/4 V (min_sub_save), other side correct share 1/2 V among them
 - If main wrong & sub wrong => sides correct share 1/2 V among them; sub penalty applied if settings.sub_penalty != 0
 - rounding: nearest integer
*/

export async function computeAndApplyScoring(gameId) {
  const gRef = gameRef(gameId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(gRef);
    if (!snap.exists()) throw "Game not found";
    const data = snap.data();

    const q = data.currentQuestion;
    if (!q) throw "No active question";

    const V = q.value || 0;
    const main = q.main;
    const sub = q.sub;

    const answers = data.answers || {};        // map playerName -> answerIndexOrText
    const players = Object.keys(data.players || {});
    const scores = Object.assign({}, data.scores || {}); // current scores to modify

    // determine which players are correct
    const correctMap = {};
    for (const pid of players) {
      let got = false;
      if (answers.hasOwnProperty(pid) && answers[pid] !== null && answers[pid] !== undefined) {
        // If correctIndex is a number and answers are indices, compare numeric
        if (typeof q.correctIndex === "number") {
          // answers[pid] might be index; if it's text, we can't evaluate — host must mark manually (we'll assume index)
          if (typeof answers[pid] === "number") {
            got = (answers[pid] === q.correctIndex);
          } else {
            // text answer; do simple case-insensitive contains check
            const correctText = (q.answers && q.answers[q.correctIndex]) || "";
            try {
              got = (answers[pid].toString().toLowerCase().includes(correctText.toString().toLowerCase()));
            } catch (e) { got = false; }
          }
        } else {
          // no numeric correctIndex; fallback simple compare to string
          const corr = q.correctIndex;
          got = (answers[pid].toString().toLowerCase() === corr.toString().toLowerCase());
        }
      } else {
        got = false;
      }
      correctMap[pid] = got;
    }

    // helper: ensure player has a score
    for (const pid of players) { if (!scores.hasOwnProperty(pid)) scores[pid] = 0; }

    // compute awards
    const awards = {};
    for (const pid of players) awards[pid] = 0;

    const main_correct = main ? !!correctMap[main] : false;
    const sub_correct = sub ? !!correctMap[sub] : false;

    if (main_correct) {
      awards[main] += V;
      // side players who are correct
      for (const pid of players) {
        if (pid === main) continue;
        if (correctMap[pid]) {
          if (pid === sub) awards[pid] += 100;
          else awards[pid] += 50;
        }
      }
    } else {
      // main wrong
      if (sub && sub_correct) {
        // sub saved
        awards[main] += Math.round(V/2);
        const min_sub_save = (data.settings && data.settings.min_sub_save) || 50;
        const sub_amt = Math.max(min_sub_save, Math.round(V/4));
        awards[sub] += sub_amt;

        // remaining half to share among side players (excluding main and sub)
        const pool = Math.round(V/2);
        const side_correct = players.filter(p => p !== main && p !== sub && correctMap[p]);
        if (side_correct.length > 0) {
          const per = Math.round(pool / side_correct.length);
          for (const pid of side_correct) awards[pid] += per;
        }
      } else {
        // sub not correct or no sub
        const pool = Math.round(V/2);
        // all side players except main who are correct share pool (this includes sub if they were correct, but here sub_correct false)
        const side_correct = players.filter(p => p !== main && correctMap[p]);
        if (side_correct.length > 0) {
          const per = Math.round(pool / side_correct.length);
          for (const pid of side_correct) awards[pid] += per;
        }
        // apply sub penalty if configured and sub exists and sub answered wrong
        const sub_penalty = (data.settings && data.settings.sub_penalty) || 0;
        if (sub && !sub_correct && sub_penalty !== 0) {
          awards[sub] += sub_penalty; // penalty likely negative
        }
      }
    }

    // apply awards to scores and save
    for (const pid of players) {
      scores[pid] = (scores[pid] || 0) + (awards[pid] || 0);
    }

    // update Firestore: scores, clear currentQuestion and answers
    tx.update(gRef, {
      scores: scores,
      currentQuestion: null,
      answers: {}
    });

    // transaction done
  });
}

// ----------------- Intermission helpers -----------------
export async function submitSuggestions(gameId, playerName, suggestionsArray) {
  if (!Array.isArray(suggestionsArray)) return;
  await updateDoc(gameRef(gameId), {
    [`intermission.suggestions.${playerName}`]: suggestionsArray
  });
}

export async function submitCategoryVotes(gameId, playerName, voteArray) {
  if (!Array.isArray(voteArray)) return;
  await updateDoc(gameRef(gameId), {
    [`intermission.votes.${playerName}`]: voteArray
  });
}

// tally votes and store top 10 in categories.round2
export async function finalizeIntermission(gameId) {
  const snap = await getDoc(gameRef(gameId));
  if (!snap.exists()) return;
  const data = snap.data();
  const votes = data.intermission?.votes || {};
  const counts = {};
  for (const arr of Object.values(votes)) {
    if (!Array.isArray(arr)) continue;
    for (const c of arr) {
      counts[c] = (counts[c] || 0) + 1;
    }
  }
  // order by count desc
  const ranked = Object.entries(counts).sort((a,b)=> b[1]-a[1]).map(x=>x[0]);
  const top10 = ranked.slice(0,10);
  await updateDoc(gameRef(gameId), {
    "categories.round2": top10
  });
  // set phase back to draft or question depending on flow
  await updateDoc(gameRef(gameId), { phase: "draft2" });
}

// ----------------- Convenience: go to scoreboard -----------------
export async function goToScoreboard(gameId) {
  await updateDoc(gameRef(gameId), { phase: "scoreboard" });
}
