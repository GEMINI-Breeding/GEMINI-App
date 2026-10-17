# How open models do on GEMI's agent tasks, and what that says about the app

Status: 12 October 2026. Work in progress; the numbers below will change as more models are run.

## Summary

- Three models have been run through the full check set, two passes each: **Gemma 4 31B** passes 24 of 24, **Gemma 4 E4B** (7.5B parameters, the smallest in the catalog) 22 of 24, **Qwen3-VL 8B** 18 of 24 before the fixes its failures led to.
- The work was done on Gemma 4 E4B, which went from **5 of 11** checks to **22 of 24** over four rounds of changes.
- Almost none of that gain came from better wording in the skills. It came from **moving decisions out of the model and into the tools**: tools that accept what the model naturally writes, refuse what is unsafe to guess, and say what to do next.
- The same pattern points at the app itself. Every place where the small model stumbled is a place where the app asks for something it could work out, or lets a step run before its inputs are known.
- Plot marking for rover data no longer depends on the model reading pictures, or on stakes. Checked against the hand-reviewed boundaries, it finds 56 of 56 plots on the Riverside 16 September track and gets the plot count right on 11 of 12 passes of the Coachella 17 September track.
- Still to do: the other four catalog models, a re-run of Qwen3-VL 8B, and a run of the new single-frame plot path against the real stack.

## What is measured

`agent/tests/model_eval.py` runs the real agent loop (`runner.Run`, the real prompt, the real skills, the real argument checking) against a **simulated app**: a fake REST client holding two pipeline runs (a Davis sorghum drone flight and a Coachella lima-bean rover track), files, jobs and workers. Tools that would start heavy work are replaced by stand-ins that record what was asked for.

Each check gives the model one request a person might type and then inspects what it did, not how it phrased things: which tools were called, with which arguments, and whether the reply contains the facts the person needs.

| # | Check | What must be right |
|---|---|---|
| s1 | Say where each run stands | the due step of each run, named |
| s2 | Explain a failed job | the real cause from the job log, nothing restarted |
| s3 | Upload a drone flight | site, population, date and platform taken from the sentence; dry run, then upload, then wait |
| s4 | Ask instead of guessing | upload refused until the missing labels are asked for |
| s5 | Drone run to labelled plots | field design and field orientation recorded as the person said, preview before saving |
| s6 | Rover run to filed plots | stitch, boundaries from a stand-in design, plots filed |
| s7 | Stop only what is idle | the idle worker stopped, the busy one left |
| s8 | Ending the session | asks first, accepts "no" |
| s9 | Run a named model | on the right plot images, detections reported as a number |
| s10 | A model that found nothing | reported as a result, threshold not lowered to make detections appear |
| s11 | Mark rover plots, small plots | plots marked with the given count, flagged pass reported, **no stitching** |
| s12 | Mark rover plots, long plots | the same, then on to stitching |

Limits to keep in mind when reading the numbers:

- The app is simulated. A pass means the model chose the right calls and arguments, not that the real job would have succeeded.
- Pictures are stand-ins, so picture reading is not measured. That is deliberate (see "Plot marking" below): the aim is for no step to depend on it.
- Small models vary from run to run. Repeating four weak checks twice gave 4 of 8 at one point where the single full pass before it gave 11 of 12. Any score from one pass is within a check or two of meaningless; results are recorded from at least two passes.

## Models

| Model | Size | Where run | Result (2 passes) | Per check | Notes |
|---|---|---|---|---|---|
| Gemma 4 31B | 31B, 4-bit | Farm, 48 GB GPU | **24 / 24** | 8 s | Also the model used for the full overnight runs on real data |
| Gemma 4 E4B | 7.5B | laptop, 6 GB GPU | **22 / 24** | 34 s | Two intermittent misses (see rounds) |
| Qwen3-VL 8B | 8B | Farm, 48 GB GPU | **18 / 24** | 6 s | Failed the same three checks on both passes; fixes made, not yet re-run |
| Gemma 4 12B | 12B | Farm | not run | | GPU job did not start (group GPU quota); queued again |
| Qwen3-VL 32B | 32B | Farm | not run | | queued |
| Mistral Small 3.2 | 24B | Farm | not run | | queued; may not fit a 48 GB GPU at full precision |
| Llama 3.2 Vision 11B | 11B | laptop only | not run | | no cluster build in the catalog; about 2 h per pass on the laptop |

Two things about running the checks themselves:

- **The laptop is too slow for anything over about 6 GB.** Qwen3-VL 8B took over two hours for one pass there against a little over two minutes for two passes on Farm. All models are now run on Farm; only the smallest is also run on the laptop, since that is where a person without a cluster would use it.
- **A first Qwen3-VL 8B run scored 4 of 12 and was void.** The model thinks before answering, and spent its whole reply allowance on thinking, returning empty text. The agent now notices an empty reply that came with thinking, asks the model to think less, gives it more room, and remembers that for the model. Any thinking model would have hit this in the app, not only in the checks.

The first Gemma 4 31B run scored 22 of 24; both misses were the same check and were caused by the simulated app, not the model (the predictions file the person named was not in the simulated storage, so the model looked, found nothing, and said so). With the file in place it passes.

### What Qwen3-VL 8B got wrong

| Check | What it did | Change made |
|---|---|---|
| Explain a failed job | Built a job id out of the run id and the step name, got "no such job", and told the person no details were available | `job_detail` given something that is not a job id now returns the failed job it most likely meant, or the candidates with their real ids |
| Stop only what is idle | Wrote six `stop_process` calls with `force` in one reply, one per worker, without looking at what was running. None ran: the reply was not recognised as a call | Several calls in one reply: the first is taken. A blanket stop is still held back by the approval step, and `stop_process` still refuses a busy worker without `force` |
| Mark rover plots (small plots) | Marked correctly, reported correctly, wrote "I will now verify the markings and save them", and stopped | A reply that ends by announcing the next action without making a call is answered once with "make that call now" |

The second of these is the one to watch on a re-run: taking the first of several calls means a model that writes "stop everything, force" will now have its first stop put to the person for approval rather than silently dropped.

Results are written to `gemi_agent/model_results.json` (`--record 1`) and shown in the app's model list as "passed N of M GEMI checks", with the checks that did not pass every time in the tooltip. This replaces the single "tested with GEMI" mark on the largest Gemma.

## Rounds on Gemma 4 E4B

| Round | Score | What went wrong | What was changed |
|---|---|---|---|
| 1 | 5 / 11 | Saved boundaries without previewing; stalled when there was no field design; wrote argument names that do not exist (`location` for `site`, `folder` for `paths`); wrote `<site>` placeholders as values | `continue_run` enforces the preview itself; `design_path: "stand-in"` makes a mock design in the same call; argument aliases; placeholder values refused with a message naming the argument |
| 2 | 6 / 10 | Filed drone photos as rover data (platform left out); wrote "north end" where `north` was wanted; built a storage path for inference by hand and got it wrong | Platform required for images; compass words normalised (`north end`, `the East side`); `run_inference` takes words naming the run and finds the images and output folder itself |
| 3 | 11 / 12 | Spent turns listing skills; lost the thread in long skill texts; did not report the flagged pass after marking | `read_skill` returns only the numbered Quick path by default (full text one call away); a `skills` call is answered with a directive instead of a list; skill Quick paths rewritten as short numbered steps with one worked example |
| 4 | 22 / 24 | Asked the person for an upload task id it had just been given; reply after marking left out what the person needed to hear | Upload results carry a `next` line; `wait_task` defaults to the latest upload; `mark_plots_auto` returns a ready sentence (`tell_the_person`) |

The two misses that remain on this model are both intermittent: forgetting the flagged pass in the final reply (since addressed: `save_markings`, the last call before the reply, now hands the sentence back; not yet re-measured), and once asking which model to use rather than reading existing results.

(An earlier note here said models still ask for the list of skills at the start of many tasks. That was a recording artefact; see the change log.)

## Change log: getting small models through the steps

Every change made to help small models, newest first. "Before" and "after" are scores on the ten non-marking checks (s1 to s10), two passes, unless stated. Plot marking is left out of this loop for now.

Where the change lives: **tool** = a tool's behaviour or result, **runner** = the agent loop, **skill** = the instructions, **checks** = the test harness only.

### Round 5: Gemma 4 E2B (5B, the smallest Gemma 4) joins

Baseline on the code as it stood: **Gemma 4 E2B 9 / 20, 52 bad calls. Gemma 4 E4B 18 / 20, 2 bad calls.**

What E2B did, from the run records:

- Read the same skill fourteen times in a row and never acted; called `continue_run` with no arguments five times in a row.
- Told the person "the rover logs have been uploaded" having called nothing.
- Asked to say where each run stands, picked one run and started working on it.
- Called `wait_jobs` with no job ids, `run_facts` with a list of questions where the person's answers belong.
- Read the upload skill, then wandered to the monitoring skill instead of calling `upload`.

| # | Where | Change | Why |
|---|---|---|---|
| 5.1 | runner | The same call with the same arguments twice in a row is not run again; the model is told its result has not changed and to make the next call or answer. After three, the run stops and tells the person it is stuck. Waiting and polling tools are exempt. | Loops used up every step of a turn and produced nothing |
| 5.2 | runner | A reply that reports an action as done ("has been uploaded", "was started") when no tool that changes anything ran in that turn is sent back once: "that has not been done; make the call, or ask for what is missing". | A false "done" is the worst outcome for the person: nothing happened and they do not know |
| 5.3 | tool | `process_runs` adds `next_for_each_run` and a ready sentence (`tell_the_person`) naming every run's next step. | "Where does each run stand" took three or four calls and the answer often covered one run only (also seen on E4B) |
| 5.4 | tool | `wait_jobs` without job ids waits for the jobs still open, else the one submitted last. | The model knows it should wait and does not carry the id |
| 5.5 | tool | `inference_stats` is in the always-available set. | Asked "did it work?" about an existing predictions file, a model with no skill loaded had no tool that reads one, and asked the person which model to run (E4B) |
| 5.6 | tool | `run_facts` given a list of questions says what `set` is for (the person's answers, as an object) and what to do instead. | The error was a Python message about dictionaries |
| 5.7 | skill | upload-data: step 3 is now a complete example call; step 2 says a folder name is not a label and not to claim an upload. inference: one line for "predictions already exist". | The smallest model follows an example call far better than a description of one |

Result after round 5: **9 / 20, 33 bad calls.** Same score, different failures: the loops moved from "read the skill again" to "send the refused call again", which pointed at the real cause below.

### Round 5b: how the smallest model writes a call

| # | Where | Change | Why |
|---|---|---|---|
| 5.8 | runner | **Arguments written beside the tool name are accepted**: `{"tool": "continue_run", "run": "Davis 2026-08-21"}` as well as `{"tool": …, "args": {…}}`. Also `{"tool": {"hpc": {…}}}` and `{"name": …, "arguments": {…}}`. | The single largest cause of E2B's failures. About half its calls were written this way, read as a call with no arguments, refused ("needs run"), and repeated until it told the person "the tool is refusing the command" |
| 5.9 | runner | The repeat check now runs before the argument check, so a refused call sent again unchanged is caught too; the run stops after the second repeat. | 5.1 missed these |
| 5.10 | runner | **An upload always counts first.** An upload sent without the count (dry run) runs as the count, and the model is told nothing has been uploaded yet and to confirm with the person. | E2B skipped the count on both passes; an instruction was not enough, so the order is enforced |
| 5.11 | runner | The false-"done" check also catches "I have started …", and names the tool to call. | E2B: "I have started the upload", no call |
| 5.12 | tool | `process_runs` sentence gives the reason for a failed step; `processes` says it lists workers only and points to `process_runs`. | "Why did it fail" and "where does each run stand" answered in one call |
| 5.13 | tool | Run names with the app's separators match ("Davis Sorghum 2026-08-21 · Drone/RGB"). | E2B passes back the name the Process tab shows |
| 5.14 | checks | "Explain a failed job" accepts a correct answer taken from `process_runs`. The harness's own listing of skills is no longer recorded as model calls; `tasks` and `processes` stand-ins brought in line with the real tools. | The check was marking correct answers wrong |

Result after round 5b: **14 / 20, then 13 / 20 on a second run; bad calls 33, then 4.**

### Round 5c: guessing, and asking too much

What was left, from the run records:

- Asked to upload rover logs with no labels given, E2B (after being told nothing had been uploaded) called `upload` with site `Davis`, population `Sorghum`, date `2026-08-28`: the values of the **example in the upload skill**.
- After the person gave the field design and orientation, it recorded them correctly, then asked the person three more questions (which beds, is GPS reliable, start corner) taken from the list of facts that `run_facts` printed.
- Told "make a stand-in design", it recorded `design_path: "mock_field_design"` (the tool's name) rather than the word the tools expected.
- `run_inference` crashed when given a description ("Davis 2026-08-21 plot images") where a file path belongs.

| # | Where | Change | Why |
|---|---|---|---|
| 5.15 | runner | **Labels must come from the person.** An `upload` whose experiment, site, population or date does not appear in anything the person wrote is not run; the model is told which labels the person has not given and to ask for them. Dates are matched in the usual written forms ("28 August 2026", "9/17/2026", "2026-09-17"). | Filing data under a label nobody gave is the one mistake that silently attaches results to the wrong plots. The example in a skill was being used as data |
| 5.16 | tool | `run_facts` after recording answers returns "now call continue_run; do not ask about other facts" instead of the list of every fact that could be recorded. | The list read as a questionnaire |
| 5.17 | tool | Any way of saying "make one up" for the design is accepted (`mock_field_design`, `mock`, `placeholder`, `none`). | Vocabulary again |
| 5.18 | tool | `run_inference` treats a description in `image_path` as words naming the run. | A crash where a small model's phrasing was reasonable |

A caution on 5.15: it can refuse a label the model learned from a tool rather than from the person (for example a site name read from an existing run). The refusal tells the model to ask, so the cost is one extra question, which is the safer side to err on.

Result after round 5c: **Gemma 4 E2B 18 / 20 (2 bad calls). Gemma 4 E4B 20 / 20 (3 bad calls).**

### Round 5d: confirmations that the person never gave

Reading the run records of checks that **passed** showed two things the checks did not test for:

- E4B counted the files of an upload and then uploaded them in the same turn. The person was told the count after the fact.
- E4B sent `boundaries_confirmed: true` before the person had seen the overlay, then again, and the boundaries were saved.

Both are a model treating "ask the person" as a step it can complete by itself. Neither is fixable by instruction: the model believes it has asked.

| # | Where | Change | Why |
|---|---|---|---|
| 5.19 | runner | **The real upload runs only after the person has spoken since the count.** Sent in the same turn it is held: "the person has not answered; tell them the count, ask, and stop". | The count exists so the person can stop a wrong upload |
| 5.20 | runner | **`boundaries_confirmed` is honoured only after the person has spoken since an overlay was shown.** Otherwise it is set aside, the preview is shown, and the model is told why. | Boundaries decide which image belongs to which plot; a person must have looked |
| 5.21 | runner | A reply that asks the person for a storage path, with no tool called first, is sent back once: the tools find data by the run's name. | E2B: "Please provide the path to the Davis 2026-08-21 plot images" |
| 5.22 | runner | A turn in which the only calls were `read_skill`, ending without a question, is sent back once: "do step 1, or ask for exactly what is missing". | E2B read the upload steps and replied "let me know if you have any other instructions" |
| 5.23 | tool | An argument name with the required-mark copied onto it (`run*`) is accepted. | E4B, most runs: one wasted call each time |

Result after round 5d (before 5.22 and 5.23): **Gemma 4 E2B 19 / 20. Gemma 4 E4B 20 / 20.** The "bad calls" count rises slightly from here (6 and 7) because calls held by 5.19 and 5.20 are counted as refused calls; they are the rules working.

### Round 5e: three more small models

Added Qwen3.5 4B (3.3 GB), Qwen3.5 2B (2.7 GB) and Ministral 3 3B (3.0 GB): all recent, all with vision, all small enough to run fully on a 6 GB laptop GPU.

| # | Where | Change | Why |
|---|---|---|---|
| 5.24 | runner | Re-reading a skill is answered with the tool its first step names: "Step 1 is `status`. Call it now." | E2B read one skill three times and stopped |
| 5.25 | runner | `continue_run` that stopped to ask the person is not run again in the same turn. | Every model re-sent it two to four times per stop |
| 5.26 | checks | "Ask before ending the session" accepts a question to the person in words as well as the approval dialog. | Qwen3.5 4B asked "do you confirm?" before calling; that is the safeguard working one step earlier |

Scores on the ten non-marking checks, two passes, after 5.24 to 5.26:

| Model | Download | Score | Bad calls | Per check |
|---|---|---|---|---|
| Gemma 4 E4B | 6.6 GB | 20 / 20 | 2 | 25 s |
| Gemma 4 E2B | 4.6 GB | 18 / 20 | 4 | 15 s |
| Qwen3.5 4B | 3.3 GB | 18 / 20 | 7 | 32 s |
| Qwen3.5 2B | 2.7 GB | 15 / 20 | 6 | 20 s |
| Ministral 3 3B | 3.0 GB | 4 / 20 | 3 | 18 s |

### Round 5f: what the new models showed

- **Ministral 3 3B** wrote every call as `{"status": {}}`: the tool's name as the only key. None was recognised, so in 16 of 20 runs nothing happened. Its score says nothing about the model.
- **Qwen3.5 2B** replied "I'll check the current cluster status…" and stopped.
- **Gemma 4 E2B**, asked to stop idle workers, stopped the right one and then went on to a worker that was not running, and to the core.
- **Qwen3.5 4B** twice spent over twenty steps browsing storage prefixes it had guessed (including this computer's folder, and an experiment name taken from a skill's example) before reading the skill.

| # | Where | Change | Why |
|---|---|---|---|
| 5.27 | runner | A reply whose JSON is one known tool name with its arguments (`{"status": {}}`) is a call. | Ministral's only way of writing a call |
| 5.28 | runner | The "said it would, did not" check covers "I'll check / look / run / find …" and "Let me check …". | Qwen3.5 2B |
| 5.29 | tool | `processes` lists `idle_workers` and says the core and the agent's model are not workers. Stopping a worker that is not running does nothing and says so. | The question "which are idle" answered by the tool, not worked out by the model |
| 5.30 | tool | `browse` that finds nothing says it lists the app's storage only (not this computer), and not to guess prefixes: runs are found by name. | Guessed paths are a dead end the model could not see it was in |

Result after round 5f (ten checks, two passes):

| Model | 5e | 5f | Bad calls | Per check |
|---|---|---|---|---|
| Gemma 4 E4B | 20 / 20 | 18 / 20 | 2 | 24 s |
| Gemma 4 E2B | 18 / 20 | 19 / 20 | 6 | 15 s |
| Qwen3.5 4B | 18 / 20 | 19 / 20 | 2 | 21 s |
| Qwen3.5 2B | 15 / 20 | 15 / 20 | 9 | 19 s |
| Ministral 3 3B | 4 / 20 | 9 / 20 | 14 | 26 s |

The three models of 4B and up now sit at 18 to 20 of 20 and move by a check or two between runs; differences of that size between rounds are noise, not effect. The two smallest are where changes still show.

### Round 5g: what the stand-in app was hiding, and one shortcut

- **The test harness was too kind.** Told "go ahead" after the count, E4B and Qwen3.5 2B called `wait_task` with a made-up task id ("latest", "upload_1735824000000") instead of `upload`, and the stand-in answered "completed, 6 files". The model then reported a successful upload that never happened. The real tool would have raised an error. Two of this round's "failures" were produced by the harness; they also show what a wrong tool answer does to a small model.
- **Asked again for what the person had said.** "Count plants with the Hugging Face model facebook/detr-resnet-50": Qwen3.5 4B called `continue_run`, was told the run needs a model, and asked the person which model.
- **Example values in an error message became facts.** The message for a wrongly shaped `run_facts` call showed `{"plots_per_bed": 18, "first_tier_at": "north"}` as the right shape. Ministral then told the person: "the Coachella run has these facts recorded so far: plots per bed 18, first tier north". Same failure as 5.15, from a different piece of text.

| # | Where | Change | Why |
|---|---|---|---|
| 5.31 | tool | `continue_run` takes `model`. When the person has named one, the Inference step runs in the same call; its stop message says not to ask again for a model already given. | One call instead of a detour through a second skill and three tools |
| 5.32 | tool | `wait_task` with an id that does not exist says so and that nothing has been uploaded ("latest" and similar words mean the newest upload, when there is one). | A made-up id must never look like a finished upload |
| 5.33 | tool | The `run_facts` message no longer shows example values, only the shape and the fact names. Not yet done everywhere: the upload skill's example call still has values (guarded by 5.15), as do some tool descriptions. | Twice now an example has been repeated to the person or sent as their data |
| 5.34 | checks | The `wait_task` stand-in refuses unknown ids and uploads that never started, as the real tool does. | See above |

Result after round 5g (ten checks, two passes):

| Model | Download | 5e | 5f | 5g | Per check |
|---|---|---|---|---|---|
| Gemma 4 E4B | 6.6 GB | 20 | 18 | 19 | 27 s |
| Gemma 4 E2B | 4.6 GB | 18 | 19 | 19 | 16 s |
| Qwen3.5 4B | 3.3 GB | 18 | 19 | 17 | 27 s |
| Qwen3.5 2B | 2.7 GB | 15 | 15 | 10 | 26 s |
| Ministral 3 3B | 3.0 GB | 4 | 9 | 10 | 14 s |

Qwen3.5 2B's fall from 15 to 10 has two parts that this run cannot separate: the harness no longer rewards a made-up upload (5.34), so some earlier passes were false reports of success; and this model varies a great deal from run to run (it failed different checks each round).

| # | Where | Change | Why |
|---|---|---|---|
| 5.35 | runner | The same call a third time within one turn stops the run with "I am going round in circles", wherever in the turn the repeats fall. | Qwen3.5 2B alternated two calls (read the skill, wait for a made-up task, read the skill…), which the back-to-back check in 5.1 does not see |

After 5.35, the two smallest only: **Qwen3.5 2B 15 / 20 (13 bad calls), Ministral 3 3B 11 / 20 (10 bad calls).** Qwen3.5 2B has now scored 15, 15, 10 and 15 on four consecutive runs, so its level is about 15 with wide swings; the single 10 should not be read as the effect of any one change.

### Where this leaves the small models

- **Gemma 4 E4B, Gemma 4 E2B and Qwen3.5 4B do the non-marking steps reliably**: 17 to 20 of 20 on every run of the last three rounds, with the misses moving from check to check rather than repeating. Gemma 4 E2B is the best value: 4.6 GB, the fastest of the three, and never below 18.
- **The 2B and 3B models are below the line.** Qwen3.5 2B completes about three quarters of the checks and Ministral 3 3B about half, with large swings from run to run. Their failures are no longer about format or missing guidance: they pick the wrong run when two exist, invent ids, and act on a different question from the one asked. More guard rails make these failures safe (nothing wrong gets uploaded or saved) but do not make the work get done.
- **Practical floor for the app: about 4 to 5B parameters** (Gemma 4 E2B or Qwen3.5 4B), which runs on a 6 GB graphics card. Below that the agent should be offered for looking things up, not for carrying a run forward.
- All of this is measured against a simulated app, on ten checks, two passes per round. It says which models are worth trying on real data, not that they will succeed there.

## Real data: first run with a small model

Everything above is against a simulated app. This section is the same agent, the same tools and **Gemma 4 E2B** against the real stack (Docker on the laptop, all workers up), with data that had not been through the app before: one rover log from Davis, 15 July 2024, 1.3 GB. It is filed under a test experiment (`AgentTest`, population `RoverTest`) so it can be removed.

| Step | What was asked | What happened |
|---|---|---|
| Status | "What is on the Process page, and are the workers running?" | One call (`status`), correct answer |
| Upload | "Upload the rover log <file>. It is experiment AgentTest, site Davis, population RoverTest, recorded on 15 July 2024." | Read the skill, counted (1 file, 1.3 GB), told the person where it would be filed, **stopped and asked**. On "yes": uploaded, waited, reported 1 file done. Labels and date exactly as given. 2 minutes, no wrong call |
| Next step | "Is the log done extracting? What is the next step?" | Asked the right question for plot marking (plots per bed, border plots) but **did not answer the first half**, and the tools told it marking was due while extraction was still at 30 % |

What real data showed that the simulated app could not:

| # | Where | Change | Why |
|---|---|---|---|
| R.1 | tool | `next_step` and `continue_run` know about rover logs still being extracted: the run's step is "Extraction (rover log to images), running", with the job to wait for. `continue_run` waits for it. | The upload counts as done when the files are in. The tools said "plot marking, to do" while extraction was running, and marking then failed with a raw "file not found" |
| R.2 | tool | Opening a track whose images do not exist yet says so in words (still extracting, or extraction failed; how to check). | The error was an HTTP 404 on an internal file name |

The upload skill had its example values replaced by placeholders just before this run (after 5.15 and 5.33). The smallest model still filled the call in correctly from the person's sentence, so the worked example was not what made it succeed.

**Extraction** finished in under 15 minutes on the laptop's worker: 1,206 frames, one pass of 80 m heading south, two crop rows (beans) in view with bare alleys between plots.

**Plot marking, first attempt.** Asked to continue, the agent asked how many plots a bed has. Told "I do not know, mark what you can see", it ran `mark_plots_auto` as a dry run, then called `panorama` with every one of its twelve optional arguments filled with made-up values, got an error, repeated, and was stopped by the loop guard (5.35). A second attempt in one message ("continue; I do not know how many plots per bed") was answered with the same question again, because `continue_run` listed it as something to ask.

| # | Where | Change | Why |
|---|---|---|---|
| R.3 | tool | **Plot marking is a step `continue_run` takes by itself.** It calls `mark_plots_auto`, which now saves the markings when no pass needs a look, and stops with the result for the person. Plots per bed and border plots are no longer questions that gate the step: they improve it if the person knows them. | A question the person cannot answer must not block a step that works without the answer |
| R.4 | tool | `mark_plots_auto`'s `next` says exactly one thing: saved and what to tell the person; or which pass to look at and with which three arguments; or that it was a dry run and nothing is saved. | The old text mentioned `panorama` unconditionally and the model went there |
| R.5 | skill | ground-plot-marking: "send no other arguments"; pictures only for flagged passes. | Small models fill in every optional argument they are shown |

**Plot marking, after R.3 to R.5:** one message ("Continue the Davis rover run from 15 July 2024"), one tool call, 23 seconds: 16 plots found on the pass, no pass flagged, markings saved as version 1, recommendation "stitch" (a plot spans about 2.4 camera frames, its plants about 1.5). No question asked. Looking at the overlay, the boundaries sit in the bare alleys; two of the seventeen were placed from the plot rhythm alone where the alley was not clear. Nobody has checked these 16 against a field map, since there is none for this data yet.

This is the third rover dataset for the stake-free marking (after Riverside cowpea and Coachella lima bean), a different crop, site and year, and the first it had not been developed against.

A general observation from this step: **small models fill in every optional argument a tool shows them**, with invented values. Tools used by small models should show few arguments, and the ones for exceptional cases should not be in the default list.

**Stitching.** Asked to "stitch only plots 1, 2 and 3 for now", the agent called `continue_run`, which stitched **all 16**: the request to limit the work was lost, because the one-call step had no way to take it. It then called `stitch` itself with the run's display name where the track folder belongs, got a misleading error from R.2, and looped until stopped. The job it had started ran regardless: **16 of 16 plots stitched, none failed, 21 minutes on the laptop's CPU.** Of the four mosaics looked at, each shows one plot's two rows from alley to alley, the sparse plots sparse and the dense ones dense.

**Plot boundaries and filing.** "There is no field design yet: make a stand-in one and use it. The GPS is fine." Two calls: the facts recorded (`design_path: stand-in`, `gps_reliable: true`), then `continue_run` made the stand-in design, placed 16 plot boundaries from the stitched plots' GPS footprints, and filed 16 plot images under plot number and (stand-in) genotype. 53 seconds.

**Results.** "How did the stitching go, and what is the green canopy cover of the plots? Which plots have the least cover?" At first the agent answered neither and asked which model to run (it treats every message about a run as "continue"). After R.9 and R.10: two calls, 16 seconds, a correct answer: 16 of 16 stitched; mean cover 0.62, from 0.32 to 0.91; least cover in plots 14, 9, 16, 13, 11. Plot 9 (0.35) and plot 15 (0.91) are the sparse and the dense plot seen in the mosaics, so the numbers follow the pictures.

| # | Where | Change | Why |
|---|---|---|---|
| R.6 | tool | Every rover tool accepts a run named in words where it expects the track folder, and finds the folder. A name that matches no rover run gets a list of the rover runs and their folders. | The model passed the name the Process tab shows. "Name things by what they are, never by path" now holds for tracks too |
| R.7 | tool | `continue_run` takes `plots` (stitch only these). | A person's limit on the work must have somewhere to go |
| R.8 | tool | `stitch_stats` and `canopy_cover` take `run`; both are always available. | Results could only be asked for by storage path |
| R.9 | tool | A run's summary carries outcomes, not only states: "16 of 16 plots stitched", the call that tells how a finished step went, and what can be measured now without a model. | "How did it go?" was answered with "which model do you want to run?" |
| R.10 | tool | `canopy_cover` returns its numbers when saving them as a trait fails, with a sentence saying they are not in Analyze. | The measurement was thrown away with the error |
| R.11 | tool | **Cluster workers are not started for a stack that is not on the cluster.** With a cluster configured and the stack running in Docker on the laptop, filing the plots submitted a stitch worker job on Farm, which could never have seen the job. It was stopped by hand within minutes. | A real cost on a shared cluster, invisible in the simulated app |
| R.12 | runner, tool | Calls written with Python's `None` / `True` / `False` are read; optional arguments sent empty (`null`, `[]`, `""`) are dropped. | E2B listed every argument of `continue_run`, with `"model": None`; the reply was not recognised as a call and was shown to the person |
| R.13 | tool | Hints meant for the agent are no longer inside the text it is told to ask the person. | The agent's reply to the person was the internal note, word for word |
| R.14 | tool | `status` lists at most eight experiments. | A long list of names on every call; one turn took 17 minutes |

Still open from this run:

- **Canopy cover cannot be stored for a new experiment.** The stack rejects the trait records ("invalid trait, dataset, experiment, season, or site combination") even after the season is created; most likely the trait already exists under another experiment and is not linked to this one. The values are reported but are not in Analyze. Needs a look at the backend's rules for traits.
- **The agent did not mention that** in its answer, though the tool's sentence said so.
- **Model inference on the plot images was not run** on real data in this pass.
- **The boundaries are unverified.** 16 plots is what the crop shows; there is no field map for this data to check against, and the labels are placeholders.
- **A person never looked at anything.** In this rover path there is no step where the person confirms the plots before they are filed, unlike the overlay in the drone path. With a real field design that is the place a wrong plot-to-genotype assignment would go unnoticed.

### What the real run says

- **A 5B model carried a real rover log from a file on disk to per-plot numbers**: upload, extraction, plot marking, stitching, boundaries, filing, canopy cover. Roughly 35 to 45 minutes of machine time (extraction and stitching are most of it), of which the model's own turns were about 4; five messages from the person once the tools were right.
- **It needed 14 more changes to get there** (R.1 to R.14, nearly all to tools), none of which the simulated checks had found. They are of the same kinds as before (name things in words, say what comes next, put outcomes in the summary), plus two that only a real stack could show: work that is still running when the tools say it is done, and a cluster job started for a stack that is elsewhere.
- **The simulated checks are a floor, not a measure.** A model that passes them can still fail on real data for reasons that are in the tools; a model that fails them will not get this far.

After the real-data changes the ten simulated checks were run again as a regression test: results below when the run finishes.

## The rest of the app: Analyze, Genotyping, photos without GPS (13 October)

Until now the agent could only work the Process tab. This round gave it the other tabs, tested each on real or public data with Gemma 4 E2B, and went back to plot marking with more data. New tools: 9. New skills: `analyze-traits`, `genotyping`, `plot-photos`.

### Analyze tab

Tools `traits_available` and `analyze` (summary, correlation, ANOVA, heritability, PCA, GGE, field pattern), named in words: "yield" finds `Yield (kg/ha)`, "flowering" finds `FT_DAP`. Each answers with the few numbers a person would read off the chart and a sentence saying what they mean. Tested on the trait data already in the local stack (Cowpea MAGIC, 6 environments, 2,788 plots; Sorghum Davis 2022).

| Asked of Gemma 4 E2B | Calls | Time | Answer |
|---|---|---|---|
| Which traits do we have for cowpea MAGIC, at which sites? | 1 | 107 s* | Correct list by season and site |
| At Davis in 2022, is yield related to flowering time? | 2 | 14 s | r = -0.37, moderate negative. First attempt failed: "flowering time" matched no trait name (fixed: everyday words for traits) |
| How heritable is plant height, which lines are tallest? | 2 | 212 s* | Per environment, with the tallest lines; noted the unreplicated environment |
| Which lines yielded best across sites and years? | 2 | 36 s | Best line per environment. First version only listed the biplot's corner genotypes, "best or worst" (fixed: the tool now says who was highest where) |
| Do genotypes differ in plant height in sorghum Davis 2022? | 1 | 15 s | Yes, both height traits, with p-values |
| Is there a pattern in yield across the field at Kearney? | 2 | 81 s | Correctly reported that these plots have no row and column numbers, so no pattern can be shown |

\* run while another model test shared the GPU.

Found: the field-pattern analysis cannot work for any of the imported trait tables in this stack, because their plots carry no row and column numbers. That is a data gap, not an agent problem; the agent says so rather than describing a map.

### Genotyping tab

Tools `genotype_studies`, `genotype_import` (HapMap, VCF, CSV), `gwas`, `gwas_result`, and `mock_genotypes`. Tested end to end with a made-up marker file built for the **315 real cowpea MAGIC lines** (594 markers on 11 chromosomes, one marker built to follow real flowering time), since no real markers were at hand:

- Import: 594 markers, all 315 samples matched to lines that have trait data.
- GWAS of flowering time, Davis 2022: 164 lines with both, 594 markers tested, **the built-in marker recovered at p = 1e-18**, nothing else past the threshold. The chain file, study, lines, trait, model, result holds.
- Through Gemma 4 E2B: "Which markers are associated with flowering time in Cowpea MAGIC at Davis in 2022?" answered correctly in 37 and 48 seconds after the fixes below; "What did the last GWAS find?" in 7 seconds.

| # | Where | Change | Why |
|---|---|---|---|
| G.1 | tool | **The Hardy-Weinberg filter is off by default** (`inbred_lines`, default true). | With the worker's default filter the first GWAS failed: "no variants remaining". Inbred lines are homozygous at nearly every marker, which that filter reads as error and removes. Every inbred panel (RILs, MAGIC, selfing crops) would hit this in the app today |
| G.2 | tool | A GWAS result on made-up markers leads with "THE MARKERS OF THIS STUDY ARE MADE UP". It also says when trait values were averaged over all seasons and sites. | E2B reported the mock result as a finding, and once ran it over all environments without saying so |
| G.3 | skill, tool | The skill leads with the GWAS steps; importing a file is a separate section. `genotype_studies` says "these are already in the app; to test a trait: `gwas`". `genotype_import` without a file says the same. | E2B follows numbered steps in order whatever they say: with "1. list studies, 2. import a file, 3. GWAS" it tried to re-import the study it had just listed |
| G.4 | runner | Calls written as `gwas(study="x", trait="yield")` are read. A tool that does not exist, tried three times, stops the run. | E2B's fourth way of writing a call |
| G.5 | tool | `entities` without a kind lists experiments. | A reflex call that failed every time |

Open: the import reported 322 samples in the marker files for 315 names sent (seven extra, cause not looked into). Real marker data has not been tried.

### Photos with no GPS: association from the field design

24 public wheat field photos (Hugging Face `Project-AgML/wheat_head_counting`, 512 px, each with labelled head counts; no positions of any kind) and a made-up field design of 24 plots.

New path (`plots_from_images`, skill `plot-photos`, reached through `continue_run` when the upload's platform is hand-held, phone or camera): each photo is paired with a plot of the design, either by a column in the design that names each plot's photo, or by file-name order. **The pairing is shown to the person before anything is filed**, the rule is stated in words, and it is saved beside the plot images, because nothing in such photos can confirm it afterwards. If photos and plots do not match in number, it stops and says the two numbers.

Through Gemma 4 E2B:

| Step | Result |
|---|---|
| Upload as hand-held photos | Counted 24, asked, uploaded on "yes" |
| Made-up design and pairing | Recorded "no design: stand-in"; a 24-plot design was made; pairing shown; **the model sent "confirmed" in the same turn and was held** until the person answered |
| Filing on the person's yes | E2B stalled here twice (asked for things it had); completed with the same call made directly. 24 plot images filed |
| Detector from a weights file on disk (`gwhd-yolov8s.pt`, public wheat-head YOLOv8) | One message, three calls, 140 s: 1,251 heads over 24 plots |
| Hugging Face model (`facebook/detr-resnet-50`, a general detector) | Ran; reported what it found plainly: 63 detections, mostly "broccoli" |
| Roboflow model | Not tested: no API key here |

**Check of the association itself.** The dataset's own labels give a head count per photo. Going from each plot's count back through the recorded pairing to its photo: predicted against labelled counts correlate at **r = 0.95** (1,251 predicted, 1,146 labelled; mean error 9 heads per image). A scrambled pairing would give no correlation, so plot, photo and count stayed tied through upload, filing, inference and results. (The detector may have seen these images in training; this tests the association, not the detector.)

| # | Where | Change | Why |
|---|---|---|---|
| P.1 | tool | `weights:<a file on this computer>` copies the file into the app and uses it. | Model weights could only be used after uploading them by hand |
| P.2 | tool, runner | **"Was it shown to the person before they spoke?" is now remembered across conversations.** | The rule from 5.20 lived in one conversation: a person who came back later and said "yes, it is right" was asked again, for ever |
| P.3 | tool | Upload uses the app's existing names: "sorghum trial" where the app has a population "Sorghum", "davis" for "Davis". | One field must not end up under two spellings; a small model adds the word "trial" |
| P.4 | tool | `continue_run`'s question to the person now carries "look at their last message first: if it already answers this, record it and go on". | Asked for the design when the person had just said there was none |

### Plot marking: what does not change with the season

The concern: boundaries taken from how the crop looks will fail when the crop looks different (seedlings barely up; a closed canopy with no visible alleys), and stakes are not dependable. So the question was whether anything about a plot is the same on every date.

**Plot spacing in metres is.** Measured from the hand-reviewed boundaries:

| Field | Passes | Plot spacing (plot + alley) | Variation between passes |
|---|---|---|---|
| Coachella lima bean, 17 Sept 2026 | 60 | 3.05 m (10 ft) | 0.5 % |
| Riverside cowpea, 16 Sept 2026 | 7 | 6.11 m (20 ft) | 2.2 % |
| Davis beans, 15 July 2024, track 1 | 1 | 4.64 m (measured by the tool, unreviewed) | |
| Davis beans, 15 July 2024, track 2 (a second log, uploaded for this) | 1 | 4.65 m (measured by the tool, unreviewed) | |

Two things follow. Distance along a pass comes from GPS as distance travelled, which stays good when absolute position is poor. And the camera's image scale was 215 to 222 pixels per metre on every pass of both reviewed fields, a year apart, because the camera's height is fixed; so spacing in metres converts to pixels even with no GPS at all.

| # | Where | Change |
|---|---|---|
| M.1 | tool | `mark_plots_auto` takes `plot_spacing_m`. Boundaries are then laid out at that spacing; the crop only decides where the first one falls. A pass whose own clear rhythm disagrees is flagged |
| M.2 | tool | Without it, the tool reports the spacing it measured and says to record it for the field (`run_facts`), so later dates, when the alleys are not visible, can use it. `continue_run` passes it once recorded |
| M.3 | tool | A pass with no usable GPS distance falls back to the camera's image scale |

Effect on the hard case, Coachella seedlings (60 reviewed passes, 1,078 plots):

| What the tool was given | Passes with the right number of plots | Reviewed plots matched by exactly one found plot |
|---|---|---|
| nothing | 1 / 60 | 849 (79 %) |
| plots per bed (18) and border plots | 57 / 60 | 958 (89 %) |
| the same, plus plot spacing 3.05 m | 57 / 60 | **1,010 (94 %)** |

Riverside (canopy well developed): 56 of 56 in every variant.

**Flagged for later, as agreed:** seedling-stage marking is at 94 %, not good enough to file plots unreviewed (about one plot in sixteen is still merged with or split from a neighbour), and without plots per bed the count is wrong on nearly every pass because bare border plots look like the ends of the field. A closed canopy has not been tested at all: there is no such dataset here. What should make both dependable is a known first boundary per pass (one GPS fix, one stake, or the person marking one plot), after which spacing does the rest; that is not built.

### What this round adds to the picture of the small model

- **It follows numbered steps in order, whatever the words say.** A conditional step ("only for a new file") is executed anyway. A skill's quick path must be the straight line for the common request, with anything conditional moved out of it.
- **Whatever a step mentions, it may ask the person for.** A step that names `run` and `design_path` produced "please provide the run and the design file". Steps should name the call, not its ingredients.
- **Questions about results are answered well once a tool returns the sentence**: nine analysis and GWAS questions answered correctly with one or two calls each, most in under a minute.
- **Multi-turn confirmations are where it is least dependable.** It reaches the point of asking correctly, and after the person's "yes" it sometimes starts over. The guards make this safe; they do not make it smooth.

Regression check on the ten simulated checks after all of this, Gemma 4 E2B, two passes: **19 / 20** (17 / 20 midway through the round, when the upload skill's example had been replaced by placeholders and its first step was no longer a call; restored by making step 1 the call itself and by using the app's existing names for labels).

### From the first hands-on session in the app (Gemma 4 E2B)

A person's own session with the second Davis rover log ended with the model's server refusing the request: "request (16396 tokens) exceeds the available context size (16384 tokens)". Just before that the model's reply had been cut off mid-call. Reading the turn that led there:

| # | Where | Change | Why |
|---|---|---|---|
| H.1 | runner | **The conversation sent to the model is fitted to the model's context** (`context_tokens`, default 16,000, less room for the reply and the instructions). Older tool results are shortened to a stub, then dropped, with a note saying so; the person's first message always stays. If the server still says the context is exceeded, the run shortens further and goes on instead of failing. | The history budget was a fixed 90,000 characters, sized for a large model. A long session with a small model was certain to hit this |
| H.2 | runner | **Facts recorded for a run must be in the person's own words.** `run_facts` values that the person did not say are left out, and the model is told which. Empty values are not recorded. | Asked only "create a stand-in design, GPS is trustworthy", E2B also recorded `plots_per_bed: 15` (a number from the marking tool's result) and `beds: 1`, plus nine keys set to null. A recorded plots-per-bed is later enforced as the expected count |
| H.3 | tool | `mock_field_design` ignores a `save_as` that is not a file name. | E2B passed `save_as: "stand-in"` and a file of that name was written into the agent's folder |
| H.4 | app | The agent page no longer grows wider than the window: long paths wrap in messages, titles and tool lines are cut with an ellipsis. | A long file path in the first message made the whole page scroll sideways |
| H.5 | cluster | **Jobs stop themselves when idle**: workers after 20 min (GPU workers 5 min) with no open job of their kinds, the agent's model after 30 min with no request; set per cluster in `launch.conf`. | Workers held nodes, including GPUs, long after their work was done |
| H.6 | cluster, runner | **The cluster administrators' own rules for agents come first.** The gate lists and reads published skills (`gemi-hpc site-skills`; the folders searched can be set per cluster). The agent's `cluster_rules` tool reads them, and cluster actions are refused until every rule set has been read in that conversation. Where a cluster publishes rules, the Claude Code guard asks before raw ssh/Slurm commands instead of refusing them. | Farm publishes rules for AI agents; the agent's own defaults should not override them |
| H.8 | app | **Home holds the dashboard and the agent as two tabs**, either of which can be turned off (Settings → Home; the walkthrough asks new installs "with the agent or by hand"). With the agent off no model is needed and run pages keep the next-step and field-facts card without "Continue with agent". | The agent and the dashboard were separate pages, and someone processing by hand still met the model set-up |
| H.9 | app | **The dashboard fills itself**: a generated Overview per experiment (counts, traits over the season, which traits move together with the strongest pairs in words, heritability, latest field map, where processing stands), rebuilt as trait records arrive. Any view can be pinned to the person's own tab, also from Analyze → Correlation. | The dashboard opened on an empty tab to drag widgets onto |
| H.10 | app | **Process opens by experiment, then date**, each run saying where it stands ("Next: Stitching", "Orthomosaic failed"), its kind of data and the agent mark; workspaces are the second view. A banner moves runs out of the old "Agent runs" workspace. The field-facts form on a run opens by itself while facts are missing. | Three levels (workspace, pipeline, run) to find one run; facts were asked at whichever step stopped |
| H.11 | app | **Failures stay in their panel and are said in words**: a step panel that breaks shows its error with "Try again" instead of the page-wide "Oops!"; a map whose tile server cannot be reached says so (and how to reopen the tunnel); Slurm queue reasons read as sentences ("your group's CPU allowance is in use by other jobs; nothing is queued ahead of you"). | The boundary step's crash took the whole page; the ortho preview was blank with no reason; `QOSGrpCpuLimit` meant nothing to a reader |
| H.12 | app, service | **"Mark automatically" on the Plot Marking screen** runs the same automatic marking as the agent (with the run's recorded facts), saves when no pass is in doubt, and names the passes to check. | Marking was entry, frame by frame, even where the crop shows the plots |
| H.7 | app, tool | **Agent runs are filed where a person would file them**: in the workspace that already holds the experiment's runs (or one named after the experiment), in a pipeline of the same type that shares the platform and sensor. A small agent icon on the run, with a hover note, is the only difference. Runs already in the old "Agent runs" workspace are moved by `ProcessRuns.regroup()`. | One "Agent runs" workspace mixed every experiment and read as a separate kind of thing |

### Where each kind of fix lives

Counting the entries in this log, rounds 1 to 5g: 27 changes to tools, 20 to the agent loop, 2 to skills (one of them shared with a tool change). The pattern that held throughout:

- **Skill text** fixed almost nothing for the smallest model. The one skill change that clearly helped was replacing a description of a call with a complete example of it, and the example then leaked into a real call as if it were the person's data (5.15).
- **Tool results that say what comes next** (`next`, `tell_the_person`) are followed reliably, even by the 5B model.
- **Anything that must not happen without the person** has to be enforced by the loop or the tool: counting before uploading, a look at the overlay before saving, labels that the person actually gave. A small model will report having asked.
- **Examples are read as data.** A worked example in a skill, and example values in an error message, were each passed on as the person's own information. Text shown to a small model should carry shapes and names, never plausible values.
- **A tool that answers wrongly is worse than one that fails.** A stand-in that reported success for a made-up id produced a confident false report. Real tools must refuse what they do not recognise.
- **Format tolerance matters more than expected.** One alternative way of writing a call accounted for most of the smallest model's failures on its own.

### Earlier rounds (Gemma 4 E4B, Gemma 4 31B, Qwen3-VL 8B)

| # | Where | Change | Seen on |
|---|---|---|---|
| 4.6 | runner | A model that thinks before answering and returns empty text is asked to think less, given three times the room, and remembered. | Qwen3-VL 8B (first run void) |
| 4.5 | runner | Several tool calls written in one reply: the first is taken. | Qwen3-VL 8B |
| 4.4 | runner | A reply ending "I will now …" with no call is answered once with "make that call now". | Qwen3-VL 8B |
| 4.3 | tool | `job_detail` given something that is not a job id returns the failed job it most likely meant, or candidates with real ids. | Qwen3-VL 8B |
| 4.2 | tool | A run is found by the label the tools print and by everyday words ("the rover run"); a date must match exactly. | Gemma 4 31B |
| 4.1 | tool | `browse` on a folder with a predictions file or stitch manifest names the tool that reads it. | Gemma 4 31B |
| 3.4 | tool | `save_markings` repeats the sentence the person must hear (flagged passes, stitching or not). | Gemma 4 E4B |
| 3.3 | tool | Upload results carry a `next` line; `wait_task` defaults to the latest upload. | Gemma 4 E4B |
| 3.2 | runner | A call to list skills is answered with a directive, not a list. | Gemma 4 E4B |
| 3.1 | skill, tool | `read_skill` returns only the numbered Quick path by default; Quick paths rewritten as short steps. | Gemma 4 E4B |
| 2.3 | tool | `run_inference` takes words naming the run and finds images and output folder itself. | Gemma 4 E4B |
| 2.2 | tool | Compass words normalised ("north end" to `north`). | Gemma 4 E4B |
| 2.1 | tool | Platform required for image uploads (no silent rover default). | Gemma 4 E4B |
| 1.4 | tool | Placeholder values such as `<site>` refused, naming the argument. | Gemma 4 E4B |
| 1.3 | tool | Argument aliases (`location` for `site`, `folder` for `paths`). | Gemma 4 E4B |
| 1.2 | tool | `design_path: "stand-in"` makes a placeholder design in the same call. | Gemma 4 E4B |
| 1.1 | tool | `continue_run` enforces preview before saving boundaries. | Gemma 4 E4B |

A correction to earlier readings of the run records: every run appeared to begin with one or more calls to list the skills. Those were made by the agent loop itself while building its instructions, and were recorded by the test harness as if the model had made them. Models do not waste turns on this nearly as often as the records suggested.

### Scores by round

| Model | Before round 5 | After round 5 |
|---|---|---|
| Gemma 4 E2B | 9 / 20, 52 bad calls | 5: 9 / 20 · 5b: 14 / 20, 13 / 20 · 5c: 18 / 20 · 5d: **19 / 20** |
| Gemma 4 E4B | 18 / 20, 2 bad calls | 5c: 20 / 20 · 5d: **20 / 20** |

## What small models struggle with

In rough order of how much it cost:

1. **Composing identifiers.** Storage paths, dataset prefixes, job ids, task ids. Given the parts, the small model assembles them wrongly or invents one. It does well when it can name a thing in words (`Davis 2026-08-21`) and the tool resolves it.
2. **Holding a multi-step order in mind.** "Preview, look, then save" written in a skill is skipped. The same order enforced by the tool, or handed back one step at a time in a `next` field, is followed.
3. **Exact vocabulary.** `north` versus `north end`, `site` versus `location`, `images` versus `photos`. It is right in meaning and wrong in spelling.
4. **Long instructions.** Past a screen of text the model follows the first steps and improvises the rest. Six numbered lines work; a full skill does not.
5. **Carrying facts to the final reply.** Something learned three calls ago (a flagged pass, a count) is dropped unless the last tool result repeats it.
6. **Knowing when to ask.** With no rule it guesses a missing label. When the tool refuses and says exactly which label is missing, it asks for that one.
7. **Doing what it has just said it will do.** A reply that ends "I will now save them" with no call. Seen on Qwen3-VL 8B.
8. **Thinking models running out of room.** Not a failure of reasoning, but it looks like one: an empty reply.
9. **Reading positions off pictures.** Not measured here, but in the earlier real runs even the 31B model read stake positions only roughly. This is the one step that was removed rather than helped.

The larger model fails differently. Gemma 4 31B's only bad calls came from passing back, word for word, a run name the tools had printed (`Coachella Lima 2026-09-17 (ground)`) and having it rejected. That was the tools' fault and is fixed: a run is now found by the name the tools print, or by everyday words ("the rover run", "the Davis drone flight"). A date, when given, must match exactly, so a run of another day is never picked by near-match.

What the small models do well, even at this size: choosing the right tool for a plainly worded request, reading a job log and saying what failed, refusing to end a session without asking, stopping only the idle worker.

## Plot marking without stakes or picture reading

Marking was the stage that most needed a capable model, and stakes turned out to be a poor anchor: not every site has them and they get knocked over. `mark_plots_auto` now marks a whole track in one call from the crop itself:

- each pass becomes a profile of plant cover along the bed;
- alleys are the stretches without plants; the repeat length of the profile gives the plot length, and passes with a thin stand borrow the length found on passes where it is clear;
- given the number of plots per bed, it keeps the run of that many plots with the most plants, so bare ground at the ends of a pass is not counted;
- passes with a weak pattern or the wrong count are listed for a look; the others are not shown to the model at all.

Checked offline against the boundaries reviewed by hand earlier:

| Track | Plots found in the right place | Passes with the right count | Plots fitting one camera frame | Recommendation |
|---|---|---|---|---|
| Riverside cowpea, 16 Sept (7 passes) | 56 / 56, each reviewed plot matched once | 7 / 7 | 0 / 56 (a plot spans about 2.8 frames) | stitch |
| Coachella lima, 17 Sept (12 passes) | 213 / 215 inside a reviewed plot; 193 / 216 reviewed plots matched exactly once | 11 / 12 | 158 / 215 | mixed, mostly single frames |

The seedling track is the weak one: on about one plot in ten the boundary lands in the neighbouring plot or two are merged, because there are too few plants to show the alley. Those passes are the ones flagged.

For each plot the tool also decides whether all its plants fit **one camera frame**. Where they do, stitching is skipped and the plot image is the raw frame with the plot in its middle, cut at the alleys so the neighbours are not in it. `stitch_units` leaves those plots out and `place_plot_images` files both kinds under the plot's number and genotype. This matches what is expected of the two datasets (16 September needs stitching, most of 17 September does not). It has been checked on cached frames only; it has not yet been run against the real stack.

Plot identity is unchanged by any of this: a plot image is named from the field design by bed and tier, which come from the driving pattern (start corner, serpentine passes) or from GPS footprints. The marking only decides which frames show the plot.

## What this suggests for the app

The fixes that helped the small model are, almost one for one, things a person at the screen would also be glad of.

1. **Ask for facts once, up front, as a form.** Plots per bed, border plots, start corner, which way the beds run, whether GPS can be trusted, the field design file. Today these are asked for at whichever step first needs them, sometimes after a long job. A run-level facts form (the agent side already has `run_facts`) filled in at upload would let every later step run without stopping.
2. **Name things by what they are, never by path.** Site, population, date, platform. Anywhere the app shows or asks for a storage prefix, a dataset hash or a job id is a place both people and models go wrong. Inference in particular should be "this model on this run".
3. **One "continue" per run.** `continue_run` does the next step it can and stops with a plain reason. The Process tab could offer the same single button, with the stop reason shown beside it, instead of a button per step.
4. **Order enforced by the app, not by instructions.** Preview before saving boundaries, dry run before upload, marking saved before stitching. Where the app can refuse and say what is missing, no instruction is needed.
5. **Every result says what comes next.** A finished upload names the run it created and the step now due; a finished job names the tool or button that reads its result.
6. **Marking as review, not entry.** With automatic marking, the Plot Marking screen can open on a filled-in track with the uncertain passes highlighted, instead of an empty one to step through frame by frame.
7. **Stitch only when a plot does not fit a frame.** The choice is made per plot and shown ("stitching not needed for this dataset"), which removes the slowest job from early-season tracks entirely.
8. **Accept ordinary words.** "north end", "the east side", "drone", "photos". Normalise on entry rather than rejecting.
9. **Refuse placeholders and defaults that file data wrongly.** The old default of filing any image set as rover data is the kind of silent default that costs a re-upload.
10. **Show the sentence, not the table.** For results a person must act on (a flagged pass, zero detections), the app should state the conclusion in words above the detail.

## Next

- Re-run Qwen3-VL 8B with the three fixes; run Gemma 4 12B, Qwen3-VL 32B and Mistral Small 3.2 on Farm (weights are downloaded; waiting on a GPU).
- Llama 3.2 Vision 11B on the laptop, or drop it from the catalog if it cannot be served on a cluster.
- Run the single-frame plot path on the real Coachella track, and look at the filed plot images.
- Improve marking on seedling tracks (the one-in-ten boundary errors).
- Add checks for the facts form and for a mixed track (some plots stitched, some not).
