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
  arrayUnion
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
    currentQuestion: null,
    currentCorrectAnswer: null,
    answers: {},
    scores: {},
    intermission: {
      gameId: gameId,
      categories: [],
      votes: {}
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
    }
  });

  return { ok: true };
}

// --------------------------------------------------------------
// REAL-TIME LISTENERS
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
  await updateDoc(doc(db, "games", gameId), { phase: phase });
}

export async function sendQuestion(gameId, questionText, answers, correctIndex) {
  await updateDoc(doc(db, "games", gameId), {
    currentQuestion: questionText,
    currentAnswers: answers,
    currentCorrectAnswer: correctIndex,
    answers: {} // reset answers for the new question
  });
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
// INTERMISSION
// --------------------------------------------------------------

export async function voteCategory(gameId, playerName, category) {
  await updateDoc(doc(db, "games", gameId), {
    [`intermission.votes.${playerName}`]: category
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
  await updateDoc(doc(db, "games", gameId), {
    "intermission.chosenCategory": chosenCategory
  });

  await setPhase(gameId, "question");
}

// --------------------------------------------------------------
// SCOREBOARD
// --------------------------------------------------------------

export async function goToScoreboard(gameId) {
  await setPhase(gameId, "scoreboard");
}

