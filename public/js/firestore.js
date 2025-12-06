// firestore.js
// Real-time Firebase interactions for the trivia game.

import { 
  initializeApp 
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  arrayUnion,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

import { firebaseConfig } from "./firebaseConfig.js";

// --------------------------------------------------------------
// INITIALIZE FIREBASE + FIRESTORE
// --------------------------------------------------------------
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// --------------------------------------------------------------
// GAME DOCUMENT HELPERS
// --------------------------------------------------------------

export async function createGame(gameId, hostName) {
  await setDoc(doc(db, "games", gameId), {
    host: hostName,
    phase: "lobby", // lobby → question → reveal → intermission → scoreboard
    createdAt: Date.now(),

    players: {},
    scores: {},

    // Current question
    currentQuestion: null,
    currentAnswers: [],
    currentCorrectAnswer: null,

    // Each player’s answer, ex: answers["Alice"] = 2
    answers: {},

    // Intermission state (category selection)
    intermission: {
      categories: [],
      votes: {}   // votes["Alice"] = [cat1, cat2, ...]
    }
  });
}

export async function joinGame(gameId, playerName) {
  const gameRef = doc(db, "games", gameId);
  const snap = await getDoc(gameRef);

  if (!snap.exists()) return { ok: false, error: "Game not found" };

  await updateDoc(gameRef, {
    [`players.${playerName}`]: {
      joinedAt: Date.now()
    },
    [`scores.${playerName}`]: 0
  });

  return { ok: true };
}

// --------------------------------------------------------------
// REAL-TIME LISTENER
// --------------------------------------------------------------

export function listenToGame(gameId, callback) {
  const gameRef = doc(db, "games", gameId);

  return onSnapshot(gameRef, (snapshot) => {
    callback(snapshot.data());
  });
}

// --------------------------------------------------------------
// GAME FLOW UPDATES
// --------------------------------------------------------------

export async function setPhase(gameId, phase) {
  await updateDoc(doc(db, "games", gameId), { phase });
}

export async function sendQuestion(gameId, questionText, answers, correctIndex) {
  await updateDoc(doc(db, "games", gameId), {
    currentQuestion: questionText,
    currentAnswers: answers,
    currentCorrectAnswer: correctIndex,
    answers: {} // reset answers for new question
  });

  await setPhase(gameId, "question");
}

export async function submitAnswer(gameId, playerName, answerIndex) {
  await updateDoc(doc(db, "games", gameId), {
    [`answers.${playerName}`]: answerIndex
  });
}

export async function revealAnswers(gameId) {
  await setPhase(gameId, "reveal");
}

export async function updateScores(gameId, newScores) {
  await updateDoc(doc(db, "games", gameId), {
    scores: newScores
  });
}

// --------------------------------------------------------------
// INTERMISSION VOTING
// --------------------------------------------------------------

export async function submitCategoryVotes(gameId, playerName, voteList) {
  // voteList must be an array of 5 categories
  if (!Array.isArray(voteList) || voteList.length !== 5) return;

  await updateDoc(doc(db, "games", gameId), {
    [`intermission.votes.${playerName}`]: voteList
  });
}

export async function setCategories(gameId, categoryList) {
  await updateDoc(doc(db, "games", gameId), {
    "intermission.categories": categoryList
  });
}

export async function startIntermission(gameId) {
  await setPhase(gameId, "intermission");
}

export async function endIntermission(gameId, chosenCategory) {
  await updateDoc(doc(db, "
