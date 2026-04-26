import admin from 'firebase-admin';

// Make sure we connect to production
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

admin.initializeApp({
  projectId: "paneles-solares-bcs-mx"
});

const db = admin.firestore();

async function checkData() {
  console.log("=== CHECKING PRODUCTION FIRESTORE DATA ===\n");
  try {
    // 1. Get latest 5 conversations
    const convs = await db.collection("conversations")
      .orderBy("updatedAt", "desc")
      .limit(5)
      .get();
      
    if (convs.empty) {
      console.log("No conversations found in production DB.");
    } else {
      console.log(`Found ${convs.docs.length} recent conversations:`);
      for (const doc of convs.docs) {
        const data = doc.data();
        let updatedAtStr = data.updatedAt ? data.updatedAt.toDate().toLocaleString() : "N/A";
        
        console.log(`\n--- CONVERSATION: ${doc.id} ---`);
        console.log(`Phone: ${data.phoneRaw}`);
        console.log(`Name: ${data.contactName}`);
        console.log(`Last Message: "${data.lastMessage}"`);
        console.log(`Last Msg Sender: ${data.lastMessageSender}`);
        console.log(`Updated At: ${updatedAtStr}`);
        
        // Let's get the messages for this conversation
        const msgs = await db.collection(`conversations/${doc.id}/messages`)
          .orderBy("timestamp", "desc")
          .limit(3)
          .get();
          
        console.log(`\n  --- RECENT MESSAGES (${msgs.docs.length}) ---`);
        msgs.docs.forEach(mDoc => {
          const mData = mDoc.data();
          const ts = mData.timestamp ? mData.timestamp.toDate().toLocaleString() : "N/A";
          console.log(`  [${ts}] ${mData.sender} (${mData.direction}): ${mData.text}`);
          console.log(`  Real wa_id (externalId): ${mData.externalId || 'N/A'}`);
        });

        // Search for related lead
        if (data.leadId) {
          const leadDoc = await db.collection("leads").doc(data.leadId).get();
          if (leadDoc.exists) {
            const leadData = leadDoc.data();
            console.log(`\n  --- ASSOCIATED LEAD: ${leadDoc.id} ---`);
            console.log(`  Lead Name: ${leadData.name}`);
            console.log(`  Lead Phone: ${leadData.phone}`);
            console.log(`  Stage: ${leadData.stage}`);
          } else {
            console.log(`\n  --- ERROR: Missing Lead doc ${data.leadId} ---`);
          }
        }
      }
    }
  } catch (error) {
    console.error("Error checking data:", error);
  }
}

checkData();
