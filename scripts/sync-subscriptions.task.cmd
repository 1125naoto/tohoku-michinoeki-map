@echo off
cd /d "C:\Users\user\Documents\DEV\道の駅"
node scripts\sync-subscriptions.mjs >> data\access-control\sync.log 2>&1
