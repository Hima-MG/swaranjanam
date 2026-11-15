process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const { initializeApp } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const db = getFirestore(initializeApp({ projectId: "demo-swaranjanam" }));
const d = (await db.collection("courses").doc(process.argv[2]).get()).data();
console.log(JSON.stringify({ title: d.title, status: d.status, availability: d.availability, hiddenFromPublic: d.hiddenFromPublic ?? "(unset)" }));
process.exit(0);
