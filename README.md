# Gradia

### Student Result Management System

Gradia is a full-stack Student Result Management System designed to simplify and digitize the process of managing, reviewing, approving, and publishing student academic results.

The system provides different interfaces and permissions for students, teachers, administrators, HODs, and principals, creating a structured result management and approval workflow.

---

## 👥 Team Members

| Name |
|---|
| Nayab Nasim |
| Ashish Kumar |
| Soumalya Roy |
| Shreyansh Soumya |
| Arhan Abdullah |

---

## 🎯 Project Objective

The objective of Gradia is to provide a centralized platform for managing student academic results while reducing manual work and improving the accuracy, transparency, and efficiency of the result publication process.

The system follows a role-based workflow where teachers enter marks, administrators compile results, the HOD reviews and approves them, and the Principal provides the final sign-off before results are published to students.

---

## 🔄 Result Management Workflow

```text
Teacher
   │
   ▼
Enter Marks
   │
   ▼
Are all marks entered?
   │
   ├── No ──► Marks Incomplete
   │              │
   │              └──────► Enter Marks Again
   │
   └── Yes
          │
          ▼
     Admin Compiles
      Result Sheet
          │
          ▼
      HOD Reviews
      Result Sheet
          │
          ▼
     Approved by HOD?
          │
      ┌───┴────┐
      │        │
     No       Yes
      │        │
      ▼        ▼
Send Back   Principal
for         Signs Off
Correction     │
      │        ▼
      └────► Publish Result
                 │
                 ▼
            Notify Students
