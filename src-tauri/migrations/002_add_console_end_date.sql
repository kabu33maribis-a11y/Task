-- Console-visible task period end. The band shown on the console calendar
-- spans [scheduled_date .. console_end_date]. Kept separate from WBS
-- start_date/end_date so that WBS edits only reach the console when the user
-- explicitly presses "コンソールに反映".
ALTER TABLE tasks ADD COLUMN console_end_date TEXT;
