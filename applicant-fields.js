window.ApplicantFieldDefinitions = [
  {
    "column": "Name",
    "label": "Full name",
    "type": "text",
    "group": "Personal details",
    "id": "applicantName",
    "required": true,
    "max": 120
  },
  {
    "column": "Contact Number",
    "label": "Contact number",
    "type": "tel",
    "group": "Personal details",
    "id": "applicantPhone",
    "required": false,
    "max": 25
  },
  {
    "column": "Email Address",
    "label": "Email address",
    "type": "email",
    "group": "Personal details",
    "id": "applicantEmail",
    "required": false,
    "max": 254
  },
  {
    "column": "Current Address",
    "label": "Current address",
    "type": "textarea",
    "group": "Personal details",
    "id": "applicantField3",
    "required": false,
    "max": 2000
  },
  {
    "column": "Gender",
    "label": "Gender",
    "type": "gender",
    "group": "Personal details",
    "id": "applicantField4",
    "required": false,
    "max": 2000
  },
  {column:"Birthdate",label:"Birthdate",type:"date",group:"Personal details",id:"applicantBirthdate",required:false,max:10},
  {
    "column": "Date",
    "label": "Date applied",
    "type": "date",
    "group": "Recruitment details",
    "id": "applicantDate",
    "required": true,
    "max": 2000
  },
  {
    "column": "JobOpeningID",
    "label": "Job / site and available slots",
    "type": "job",
    "group": "Recruitment details",
    "id": "applicantJob",
    "required": true,
    "max": 100
  },
  {
    "column": "Position",
    "label": "Position applied",
    "type": "hidden",
    "group": "Recruitment details",
    "id": "applicantPosition",
    "required": false,
    "max": 2000
  },
  {
    "column": "Site",
    "label": "Location / site",
    "type": "hidden",
    "group": "Recruitment details",
    "id": "applicantSite",
    "required": false,
    "max": 2000
  },
  {
    "column": "Source",
    "label": "Source",
    "type": "source",
    "group": "Recruitment details",
    "id": "applicantSource",
    "required": true,
    "max": 2000
  },
  {
    "column": "Status",
    "label": "Status",
    "type": "status",
    "group": "Recruitment details",
    "id": "applicantStatus",
    "required": true,
    "max": 2000
  },
  {
    "column": "Ongoing Requirements Status",
    "label": "Ongoing requirements status",
    "type": "text",
    "group": "Requirements",
    "id": "applicantField11",
    "required": false,
    "max": 2000
  },
  {
    "column": "Submission Date",
    "label": "Submission date",
    "type": "date",
    "group": "Recruitment details",
    "id": "applicantField13",
    "required": false,
    "max": 2000
  },
  {
    "column": "Date of Interview",
    "label": "Interview date / scheduling details",
    "type": "text",
    "group": "Interview and onboarding",
    "id": "applicantField15",
    "required": false,
    "max": 2000
  },
  {
    "column": "For Onboarding Target Start Date",
    "label": "Onboarding target start date / details",
    "type": "text",
    "group": "Interview and onboarding",
    "id": "applicantField16",
    "required": false,
    "max": 2000
  },
  {
    "column": "ScheduleDate",
    "label": "Scheduled date and time",
    "type": "datetime-local",
    "group": "Interview and onboarding",
    "id": "applicantField17",
    "required": false,
    "max": 2000
  },
  {
    "column": "ScheduleType",
    "label": "Schedule type",
    "type": "text",
    "group": "Interview and onboarding",
    "id": "applicantField18",
    "required": false,
    "max": 80
  },
  {
    "column": "ScheduleResponse",
    "label": "Response / attendance",
    "type": "response",
    "group": "Interview and onboarding",
    "id": "applicantField19",
    "required": false,
    "max": 2000
  },
  {
    "column": "PHONE INTERVIEW DATE",
    "label": "Phone interview date",
    "type": "date",
    "group": "Stage dates",
    "id": "applicantField20",
    "required": false,
    "max": 2000
  },
  {
    "column": "F2F INTERVIEW DATE",
    "label": "Face-to-face interview date",
    "type": "date",
    "group": "Stage dates",
    "id": "applicantField21",
    "required": false,
    "max": 2000
  },
  {
    "column": "ONLINE INTERVIEW DATE",
    "label": "Online interview date",
    "type": "date",
    "group": "Stage dates",
    "id": "applicantField22",
    "required": false,
    "max": 2000
  },
  {
    "column": "ORIENTATION DATE",
    "label": "Orientation date",
    "type": "date",
    "group": "Stage dates",
    "id": "applicantField23",
    "required": false,
    "max": 2000
  },
  {
    "column": "EXAM DATE",
    "label": "Exam date",
    "type": "date",
    "group": "Stage dates",
    "id": "applicantField24",
    "required": false,
    "max": 2000
  },
  {
    "column": "NO SHOW DATE",
    "label": "No-show date",
    "type": "date",
    "group": "Stage dates",
    "id": "applicantField25",
    "required": false,
    "max": 2000
  },
  {
    "column": "NO ANSWER DATE",
    "label": "No-answer date",
    "type": "date",
    "group": "Stage dates",
    "id": "applicantField26",
    "required": false,
    "max": 2000
  },
  {
    "column": "DATE SCREENED",
    "label": "Date screened",
    "type": "date",
    "group": "Stage dates",
    "id": "applicantField27",
    "required": false,
    "max": 2000
  },
  {
    "column": "FINAL INTERVIEW DATE",
    "label": "Final interview date",
    "type": "date",
    "group": "Stage dates",
    "id": "applicantField28",
    "required": false,
    "max": 2000
  },
  {
    "column": "DATE HIRED",
    "label": "Date hired",
    "type": "date",
    "group": "Stage dates",
    "id": "applicantField29",
    "required": false,
    "max": 2000
  },
  {
    "column": "JOB OFFER DATE",
    "label": "Job offer date",
    "type": "date",
    "group": "Stage dates",
    "id": "applicantField30",
    "required": false,
    "max": 2000
  },
  {
    "column": "REQUIREMENTS COMPLETION DATE",
    "label": "Requirements completion date",
    "type": "date",
    "group": "Stage dates",
    "id": "applicantField31",
    "required": false,
    "max": 2000
  },
  {
    "column": "Date of Deployment",
    "label": "Deployment date",
    "type": "date",
    "group": "Stage dates",
    "id": "applicantField32",
    "required": false,
    "max": 2000
  },
  {
    "column": "REJECTED DATE",
    "label": "Rejected date",
    "type": "date",
    "group": "Stage dates",
    "id": "applicantField33",
    "required": false,
    "max": 2000
  },
  {
    "column": "BACKOUT DATE",
    "label": "Backout date",
    "type": "date",
    "group": "Stage dates",
    "id": "applicantField34",
    "required": false,
    "max": 2000
  },
  {
    "column": "Remarks",
    "label": "Remarks",
    "type": "textarea",
    "group": "Notes and source",
    "id": "applicantField35",
    "required": false,
    "max": 2000
  }
];
window.ApplicantDocumentTypes = ["NBI","POLICE","SSS","PHILHEALTH","PAG IBIG","TIN","MEDICAL","DIPLOMA","TOR","RESUME"];
