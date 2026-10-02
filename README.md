# QueueSmart

QueueSmart is a smart queue management application.

## Assignment 2

This project implements the front end using React and Vite.
Backend functionality is mocked for this assignment.

## Team

- Nik Nambisseril: Authentication and Service Management
- Abel Joseph: User Dashboard, History, and Notifications
- Bryan Biju: Join Queue and Queue Status
- Heera Shetty: Admin Dashboard and Queue Management


## Run locally

Install Node.js LTS, then run:

```bash
cd frontend
npm install
npm run dev
```

Open the local URL printed in the terminal.

## Check the application

From the frontend folder:

```bash
npm run lint
npm run build
```

## Shared foundation

- Shared styles: `frontend/src/styles/global.css`
- Navigation: `frontend/src/components/layout/Navbar.jsx`
- Routes: `frontend/src/routes/`
- Screens currently show placeholders.
- Authentication and backend behavior are not implemented yet.

## Feature ownership

- Nik: `pages/auth/`, `ServiceManagement` screen,
  `authRoutes.jsx`, and `serviceRoutes.jsx`
- Abel: User Dashboard, History, and notification components
- Bryan: Join Queue and Queue Status
- Heera: Admin Dashboard, Queue Management, and `adminRoutes.jsx`