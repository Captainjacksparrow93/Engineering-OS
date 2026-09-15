# ACS Engitech - Engineering OS
## Project Management: From Creation to Completion (Executive Summary)

---

### Executive Overview

This document presents a simple, clear, step-by-step overview of how projects are created, executed, tracked, and completed in **Engineering OS** at ACS Engitech.

The platform is designed around three business principles:
1. **Top-Down Accountability**: Department Heads commit the schedule and scope; Project Managers execute; Engineers deliver.
2. **Quality Compliance**: Every automation job strictly follows the company's approved 13-step checklist from `Automation Check List.pdf`.
3. **Instant Transparency**: Directors and Department Heads can see *what is going on*, *who is doing what*, and *what is blocked* at any second without calling meetings.

---

### 1. The Company Hierarchy (Who Does What)

```
                            [ 1. DIRECTOR ]
        Satish Nagar | Bhavesh Prajapati | Shaktikumar Vasava
           (Full Company Visibility, Financials & Governance)
                                   |
           +-----------------------+-----------------------+
           |                                               |
 [ 2. HEAD OF TECHNICAL ]                        [ 2. HEAD OF SERVICE ]
   Dilipkumar Asediya                             Rajani Bhurabhai Nagar
 (Creates Projects, Sets Dates,                 (Creates Projects, Sets Dates,
   Manages Checklist Templates)                   Manages Checklist Templates)
           |                                               |
           +-----------------------+-----------------------+
                                   |
                         [ 3. PROJECT MANAGER ]
               Parth Nagar (PM 1) | Paras Prajapati (PM 2)
              (Day-to-day Execution, Reviews & Approvals)
                                   |
    +------------------+-----------+-----------+-------------------+
    |                  |                       |                   |
[ ASST. MANAGER ] [ SR. ENGINEER ]      [ JR. ENGINEER ]    [ TRAINEE ENGINEER ]
   (Tech Leads)    (Complex Logic)       (HW / I/O Mapping)   (Testing / Assist)
```

---

### 2. The 5-Step Project Flow

```
[ Step 1: Head Creates Project ]
     │  Selects Scope (e.g. 2x PLC, 1x SCADA), Assigns PM, Sets Target Delivery Date
     ▼
[ Step 2: System Builds 13 Tasks ]
     │  Step 1 is "TODO" | Steps 2 to 13 are "BLOCKED" (Cannot start prematurely)
     ▼
[ Step 3: Engineer Executes & Logs Progress % ]
     │  No hourly logging. Engineer updates % (25%, 50%, 75%, 100%).
     │  If stuck: Flags Roadblock with handwritten explanation (alerts boss in red).
     ▼
[ Step 4: PM Review & Quality Gate ]
     │  At 100%, task moves to "Pending PM Review".
     │  PM inspects deliverables:
     │     • APPROVE ──► Task marked Done ──► NEXT task auto-unlocks from BLOCKED to TODO!
     │     • REJECT  ──► Sent back to engineer with corrective feedback.
     ▼
[ Step 5: Final Simulation & Project Completion ]
     │  When Step 13 (Simulation Trial) is approved:
     │  System prompts PM: "All tasks completed! Mark project completed as well?"
     │     • YES ──► Project marked COMPLETED ──► Department Head receives instant notification!
```

---

### Step-by-Step Explanation

#### Step 1: Department Head Initiates the Project
* **Who does it**: Exclusively the Department Head (*Dilipkumar Asediya* or *Rajani Nagar*).
* **What they enter**:
  1. **Order Details**: Client Name (e.g. *Tata Chemicals*), Project Name, PO Number, Order Value, Kick-off Date, and Target Delivery Date.
  2. **Scope & Quantities**:
     - `[x] PLC Programming + Simulation` — Quantity: **2 PLCs**
     - `[x] SCADA Programming + Simulation` — Quantity: **1 Station**
     - `[ ] HMI Programming + Simulation` — Quantity: 0
  3. **Assign PM**: Selects either **Parth Nagar** (PM 1) or **Paras Prajapati** (PM 2).
     - Checkbox: `[x] Show PM team members only` (checked by default).
     - When unchecked, the Head can cross-assign engineers from across the company grouped by Seniority (*Asst. Manager $\to$ Sr. $\to$ Jr. $\to$ Trainee*).
  4. **The 13 Standard Tasks**: For every PLC/SCADA unit selected, the system displays the 13 checklist steps with planned dates and an Assignee dropdown on the right.
  5. **One-Click Creation**: The Head clicks **"Create Automation Project & Tasks"**. Everything is built in 1 second.

---

#### Step 2: Sequential Pipeline & Blocker Rules
* Tasks are created following strict engineering precedence:
  - **Step 1** (*Review Control Philosophy*) starts in status **`TODO`** (ready to work).
  - **Steps 2 through 13** start in status **`BLOCKED`**.
* **Strict Rule**: An engineer **cannot start** and **cannot complete** Step 2 until Step 1 has been approved by the Project Manager.
* **Step 13 (Simulation Trial)** is strictly locked until all prior 12 steps (hardware config, I/O mapping, PID logic, alarms, auto sequence) are 100% complete and approved.

---

#### Step 3: Engineer Execution & Progress % (No Hourly Logging)
* Assigned engineers open their personal **"My Work"** dashboard.
* **No Daily Hours**: Engineers do not spend time punching daily hourly timesheets.
* **Progress Percentage**: Engineers update **Progress %** (e.g. *50%, 75%, 100%*) and type a brief technical note on what was completed.
* **What if an Engineer Gets Stuck? (Roadblock Radar)**:
  - If an engineer is waiting on external dependencies (e.g. *waiting for client GA drawings, unanswered technical queries, vendor GSD file missing*):
  - They click **Raise a Blocker** and type their exact handwritten comment.
  - **No Generic Dropdowns**: The system requires a specific explanation so management knows exactly what the issue is.
  - The task turns red and immediately flashes on the **Executive Dashboard** under the **Roadblock Radar** so Directors and Heads can call the client or vendor immediately.

---

#### Step 4: PM Quality Gate (Review & Approval)
* When an engineer reaches 100%, the task moves to **`IN_REVIEW`** (Pending PM Sign-Off).
* The Project Manager (*Parth Nagar* or *Paras Prajapati*) inspects the work and chooses:
  1. **Approve & Complete**:
     - The task officially turns **`COMPLETED`**.
     - The system **automatically unblocks** the next step from `BLOCKED` to `TODO`!
     - The next engineer receives an instant in-app notification: *"Step 1 is done; Step 2 is now unlocked for you."*
  2. **Send Back**:
     - If code cleaning or I/O checks are incomplete, the PM returns the task with corrective feedback notes.

---

#### Step 5: Final Simulation Sign-Off & Head Notification
* When the Project Manager approves the final milestone (**Step 13: Simulation Trial**):
  - The system checks if 100% of all tasks across the project are complete.
  - An interactive prompt appears for the PM:
    > **"All tasks on this project are completed! Would you like to mark the project as Completed as well?"**  
    > `[ Yes, Mark Project Completed ]` &nbsp;&nbsp;&nbsp;&nbsp; `[ Not Yet ]`
  - If the PM needs extra time for final checks, they click *"Not Yet"*.
  - When the PM clicks *"Yes"*:
    - The project status moves to **`COMPLETED`**.
    - An instant automated notification is delivered to the **Department Head** (*Dilip Asediya* / *Rajani Nagar*):
      > *"Project [ACS-PRJ-XXX: Tata Chemicals] has been completed by PM Parth Nagar and is ready for your review."*

---

### 3. The Executive Operations Dashboard (For Bosses & Directors)

Directors and Department Heads have a consolidated screen answering the 3 most critical business questions at a single glance:

```
==================================================================================================================
 ACS ENGITECH - EXECUTIVE OPERATIONS DASHBOARD                                [ Role: Director / Head ]
==================================================================================================================
 [  8 ACTIVE PROJECTS  ]   [  2 AT RISK / DELAYED  ]   [  3 ACTIVE ROADBLOCKS  ]   [  4 PENDING PM REVIEWS  ]

 1. WHAT IS GOING ON? (Live Projects Overview)
 -----------------------------------------------------------------------------------------------------------------
 PROJECT & CLIENT             PM          CURRENT STEP                     TARGET DATE     PROGRESS   HEALTH
 -----------------------------------------------------------------------------------------------------------------
 Tata Chemicals - DM Water    Parth N.    Step 4 of 13: Memory Mapping     15 Nov (14d)    [====    ] 42%    HEALTHY
 Reliance - Hazira Cracker    Paras P.    Step 8 of 13: Alarms & Trip      28 Oct (3d late)[======  ] 68%    AT RISK
 Nirma - Caustic Chlorine     Parth N.    Step 2 of 13: Verify I/O List    05 Dec (35d)    [==      ] 18%    BLOCKED

 2. WHAT BLOCKERS EXIST TODAY? (Roadblock Radar - Handwritten Notes)
 -----------------------------------------------------------------------------------------------------------------
 ! Nirma Caustic Chlorine | Step 2 (Verify I/O List) | Engineer: Sahil Patil (Jr.)
   Handwritten Note: "Client has not approved revised DI/DO list for MCC Panel 3. E-mailed client on 10th Sep; awaiting confirmation."
   Impact: Blocked for 2 days -> Downstream Steps 3-13 locked. [ Intervene / Contact Client ]

 3. WHO IS DOING WHAT RIGHT NOW? (Live Team Operations)
 -----------------------------------------------------------------------------------------------------------------
 TEAM 1: PARTH NAGAR (11 Engineers)             | TEAM 2: PARAS PRAJAPATI (10 Engineers)
 • Shivam Prajapati (Sr)  -> Tata: Step 5 (50%) | • Agastya Patel (Sr)  -> Reliance: Step 8 (Blocked: GSD)
 • Sahil Patil (Jr)       -> Nirma: Step 2 (Blk)| • Jigar Patel (Sr)    -> Adani: Step 12 (Sim Prep)
 • Abbasali Sunasara (Jr) -> Tata: Step 3 (75%) | • Ronak Panchal (Jr)  -> Adani: Step 6 (Scaling)
 • Agastya/Trainees       -> Available (Free)   | • Trainees            -> Available (Free)

 4. EVERY ACTIVITY TRACKED (Real-Time Live Feed)
 -----------------------------------------------------------------------------------------------------------------
 15:42  Parth Nagar APPROVED Step 1 on Tata DM Water -> Step 2 automatically unlocked for Sahil
 14:10  Sahil Patil raised ROADBLOCK on Nirma: "Client has not approved revised DI/DO list..."
 10:15  Dilipkumar Asediya CREATED new project: "Tata Chemicals - DM Water" with 2x PLC assigned to Parth Nagar
==================================================================================================================
```

---

### 4. Master Checklist Templates Management (`/pm/templates`)

* **Directors & Department Heads Only**: Project Managers and Junior Engineers cannot modify master checklist structures.
* Leadership can:
  - Add or delete subtasks.
  - Adjust default days for each step.
  - Change recommended seniority level (*Asst. Mgr*, *Sr.*, *Jr.*, *Trainee*).
  - Configure default blocker rules.

---

### 5. Summary of Key Benefits for ACS Leadership

| Feature | How It Helps Management |
| :--- | :--- |
| **Standardized 13 Steps** | Eliminates forgotten steps (e.g. missing diagnostic screens or unverified hardware configurations). Every project follows the same quality standard. |
| **Automatic Blocker Unlocking** | Engineers cannot start work out of order or bypass prerequisite safety interlocks. The next step unlocks only when the PM approves the prior step. |
| **Roadblock Radar** | Management learns about client delays or missing vendor files immediately, not on the delivery deadline. |
| **No Timesheet Friction** | Engineers update Progress % (0% to 100%) with descriptive technical notes instead of wrestling with daily hour logs. |
| **Clear Team Division** | Workload is visible side-by-side between Parth Nagar''s team and Paras Prajapati''s team to balance engineering capacity. |
