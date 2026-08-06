"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Send, Plus, Camera, ChevronLeft, Edit2, Check, Trash2, LogOut, Building2, ChevronDown, X } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { getEmployee, logout } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { Exhibition } from "@/lib/types";

interface Message {
  sender: "system" | "employee";
  text?: string;
  image?: string;
  voice?: boolean;
  extractedData?: any;
  timestamp: string;
  showBackSidePrompt?: boolean;
  showBackUploadButton?: boolean;
  showServicesPrompt?: boolean;
  // Voice confirmation UI
  voiceAnalysis?: {
    lead_id: number;
    transcript: string;
    summary: string;
    segment: string;
    priority: string;
    interest_level?: string;
    confidence: number;
  };
}

export default function ChatPage() {
  const router = useRouter();
  const [employee, setEmployee] = useState<any>(null);

  const [exhibition, setExhibition] = useState<Exhibition | null>(null);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [showExhibitionPicker, setShowExhibitionPicker] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);

  const [input, setInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [showUploadOptions, setShowUploadOptions] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [correctionMode, setCorrectionMode] = useState<{
    active: boolean;
    leadId: number | null;
    field: string | null;
    pendingExtraction?: any;
  }>({ active: false, leadId: null, field: null, pendingExtraction: null });

  // Two-sided card upload state
  const [twoSidedMode, setTwoSidedMode] = useState<{
    active: boolean;
    frontImage: File | null;
    frontImageUrl: string | null; // Server URL instead of base64
    awaitingBackSide: boolean;
  }>({ active: false, frontImage: null, frontImageUrl: null, awaitingBackSide: false });

  // Voice recording state
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [currentLeadId, setCurrentLeadId] = useState<number | null>(null);

  // Pending voice confirmation state
  const [pendingVoiceConfirmation, setPendingVoiceConfirmation] = useState<{
    lead_id: number;
    summary: string;
    segment: string;
    priority: string;
    interest_level: string;
  } | null>(null);

  // Voice confirmation modal state (for /chat page)
  const [voiceConfirmModal, setVoiceConfirmModal] = useState<{
    show: boolean;
    transcript: string;
    summary: string;
    segment: string;
    priority: string;
    interestLevel: string;
    mentionedLeadName?: string;
    mentionedCompany?: string;
    selectedLeadId?: number;
  }>({
    show: false,
    transcript: "",
    summary: "",
    segment: "",
    priority: "",
    interestLevel: "",
  });

  const [availableLeads, setAvailableLeads] = useState<any[]>([]);

  // Pending card confirmation state
  const [pendingCardConfirmation, setPendingCardConfirmation] = useState<{
    extraction: any;
    frontImage: File;
    backImage: File | null;
    sessionId: string;
    tempId?: string;
  } | null>(null);

  // Services prompt state (mandatory if not extracted from card)
  const [servicesPromptInput, setServicesPromptInput] = useState('');
  const [servicesPromptList, setServicesPromptList] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const backImageInputRef = useRef<HTMLInputElement>(null);
  const backGalleryInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [webcamOpen, setWebcamOpen] = useState(false);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [webcamForBack, setWebcamForBack] = useState(false);

  useEffect(() => {
    const emp = getEmployee();
    setEmployee(emp);
    if (!emp) {
      router.push('/auth/login');
      return;
    }

    // Load messages from localStorage — auto-expire anything older than 24 hours
    const WELCOME: Message = {
      sender: "system",
      text: "Please upload visiting card to add a new lead.",
      timestamp: new Date().toISOString()
    };
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
    const savedMessages = localStorage.getItem('chatMessages');
    if (savedMessages) {
      try {
        const parsedMessages: Message[] = JSON.parse(savedMessages);
        const recentMessages = parsedMessages.filter(m =>
          new Date(m.timestamp).getTime() > cutoff24h
        );
        if (recentMessages.length > 0) {
          setMessages(recentMessages);
        } else {
          // All messages expired — start fresh
          localStorage.removeItem('chatMessages');
          setMessages([WELCOME]);
        }
      } catch (e) {
        console.error('Failed to parse saved messages:', e);
        setMessages([WELCOME]);
      }
    } else {
      setMessages([WELCOME]);
    }

    loadExhibitions();
  }, [router]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Save messages to localStorage whenever they change
  // Keep server URLs, only remove base64 images
  useEffect(() => {
    if (messages.length > 0) {
      try {
        // Filter out base64 images but keep server URLs
        const messagesToSave = messages.slice(-50).map(msg => ({
          ...msg,
          // Keep server URLs (http://...), remove base64 (data:image/...)
          image: msg.image && msg.image.startsWith('http') ? msg.image :
                 msg.image && msg.image.startsWith('data:') ? '[Image]' : msg.image
        }));
        localStorage.setItem('chatMessages', JSON.stringify(messagesToSave));
      } catch (e) {
        // If quota exceeded, clear old messages and try again
        console.warn('localStorage quota exceeded, clearing old messages');
        try {
          localStorage.removeItem('chatMessages');
          const recentMessages = messages.slice(-20).map(msg => ({
            ...msg,
            image: msg.image && msg.image.startsWith('http') ? msg.image : undefined
          }));
          localStorage.setItem('chatMessages', JSON.stringify(recentMessages));
        } catch (e2) {
          console.error('Failed to save messages to localStorage:', e2);
        }
      }
    }
  }, [messages]);

  const loadExhibitions = async () => {
    try {
      const response = await api.getExhibitions();
      setExhibitions(response);

      // Set first active exhibition as default
      const activeExh = response.find((e) => e.is_active);
      if (activeExh) {
        setExhibition(activeExh);
      }
    } catch (error) {
      console.error('Failed to load exhibitions:', error);
    }
  };

  const addMessage = (msg: Partial<Message>) => {
    setMessages(prev => [...prev, {
      ...msg,
      timestamp: new Date().toISOString()
    } as Message]);
  };

  const handleClearChat = () => setShowClearConfirm(true);

  const confirmClearChat = () => {
    localStorage.removeItem('chatMessages');
    setMessages([{
      sender: "system",
      text: "Please upload visiting card to add a new lead.",
      timestamp: new Date().toISOString()
    }]);
    setShowClearConfirm(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Clear the input immediately
    e.target.value = '';

    setIsProcessing(true);

    try {
      // Create a local blob URL for display — no server upload needed
      const imageUrl = URL.createObjectURL(file);

      addMessage({
        sender: "employee",
        image: imageUrl,
        text: "Front Side of Visiting Card"
      });

      setTwoSidedMode({
        active: true,
        frontImage: file,
        frontImageUrl: imageUrl,
        awaitingBackSide: true
      });

      addMessage({
        sender: "system",
        text: "Does this card have a back side with additional information?",
        showBackSidePrompt: true
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle back side upload
  const handleBackImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !twoSidedMode.frontImage) return;

    // Clear the input immediately
    e.target.value = '';

    setIsProcessing(true);

    try {
      // Create a local blob URL for display — no server upload needed
      const imageUrl = URL.createObjectURL(file);

      addMessage({
        sender: "employee",
        image: imageUrl,
        text: "Back Side of Visiting Card"
      });

      await processCardExtraction(twoSidedMode.frontImage!, file);
    } catch (error) {
      console.error('Failed to process back image:', error);
      addMessage({
        sender: "system",
        text: "Failed to process back image. Please try again."
      });
      setIsProcessing(false);
    }
  };

  const isMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent);

  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  const openWebcam = useCallback(async (forBack = false) => {
    try {
      // First request permission so device labels become available
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      tempStream.getTracks().forEach(t => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(d => d.kind === 'videoinput');
      setVideoDevices(cameras);

      const deviceId = cameras[0]?.deviceId || '';
      setSelectedDeviceId(deviceId);
      setWebcamForBack(forBack);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true
      });
      setWebcamStream(stream);
      setWebcamOpen(true);
    } catch {
      toast.error('Could not access camera. Please allow camera permission.');
    }
  }, []);

  const switchCamera = useCallback(async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    webcamStream?.getTracks().forEach(t => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } }
    });
    setWebcamStream(stream);
  }, [webcamStream]);

  const closeWebcam = useCallback(() => {
    webcamStream?.getTracks().forEach(t => t.stop());
    setWebcamStream(null);
    setWebcamOpen(false);
  }, [webcamStream]);

  const captureWebcam = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], 'webcam.jpg', { type: 'image/jpeg' });
      closeWebcam();
      if (webcamForBack) {
        // simulate back image upload
        const fakeEvent = { target: { files: [file], value: '' } } as any;
        handleBackImageUpload(fakeEvent);
      } else {
        const fakeEvent = { target: { files: [file], value: '' } } as any;
        handleImageUpload(fakeEvent);
      }
    }, 'image/jpeg', 0.92);
  }, [webcamForBack, closeWebcam]);

  useEffect(() => {
    if (webcamOpen && videoRef.current && webcamStream) {
      videoRef.current.srcObject = webcamStream;
      videoRef.current.play();
    }
  }, [webcamOpen, webcamStream]);

  const handleTakePhoto = (forBack = false) => {
    if (isMobile()) {
      if (forBack) backImageInputRef.current?.click();
      else cameraInputRef.current?.click();
    } else {
      openWebcam(forBack);
    }
  };

  // Handle "No Back Side" - process front only
  const handleNoBackSide = async () => {
    if (!twoSidedMode.frontImage) return;

    addMessage({
      sender: "employee",
      text: "No back side"
    });

    await processCardExtraction(twoSidedMode.frontImage, null);
  };

  // Handle "Yes, has back side" - show upload option
  const handleHasBackSide = () => {
    addMessage({
      sender: "employee",
      text: "Yes, uploading back side..."
    });

    addMessage({
      sender: "system",
      text: "Please upload the back side of the card:",
      showBackUploadButton: true
    });
  };

  // Process card extraction with front and optional back image (PREVIEW MODE - doesn't create lead)
  const processCardExtraction = async (frontImage: File, backImage: File | null) => {
    setIsProcessing(true);
    setTwoSidedMode({ active: false, frontImage: null, frontImageUrl: null, awaitingBackSide: false });

    try {
      // Use PREVIEW endpoint - does NOT create lead yet
      const result = await api.extractCardPreview(
        frontImage,
        backImage,
        exhibition?.exhibition_id || 1
      );

      if (result.extraction) {
        const isTwoSided = backImage !== null;

        // Check for duplicates
        const isDuplicate = result.duplicate_check?.is_duplicate || false;
        const duplicateCount = result.duplicate_check?.duplicate_count || 0;
        const topDuplicate = result.duplicate_check?.duplicates?.[0];

        let duplicateWarning = '';
        if (isDuplicate && topDuplicate) {
          duplicateWarning = `\n\n⚠️ Duplicate detected — this contact may already exist:\nLead #${topDuplicate.lead_id} · ${topDuplicate.visitor_name || 'Unknown'} · ${topDuplicate.company_name || 'Unknown'}\nPhone: ${topDuplicate.phone || 'N/A'} · Match: ${topDuplicate.similarity_score}%${duplicateCount > 1 ? `\n${duplicateCount} similar leads found.` : ''}`;
        }

        // Store pending confirmation data
        setPendingCardConfirmation({
          extraction: result.extraction,
          frontImage,
          backImage,
          sessionId: result.task_id || '',
          tempId: result.temp_id || undefined
        });

        // Add system message with extracted data
        const fmtSeg = (s?: string) => s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'N/A';
        const fmtPri = (p?: string) => p ? p.charAt(0).toUpperCase() + p.slice(1) : 'N/A';

        addMessage({
          sender: "system",
          text: `Card extracted${isTwoSided ? ' (2-sided)' : ''} · ${(result.extraction.confidence * 100).toFixed(0)}% confidence

Name: ${result.extraction.persons?.[0]?.name || 'N/A'}
Company: ${result.extraction.company_name || 'N/A'}
Phone: ${result.extraction.phones?.[0] || 'N/A'}
Email: ${result.extraction.emails?.[0] || 'N/A'}${result.extraction.services?.length ? `\nServices: ${result.extraction.services.join(', ')}` : ''}

Segment: ${fmtSeg(result.segment)}  ·  Priority: ${fmtPri(result.priority)}${duplicateWarning}`,
          extractedData: {
            ...result.extraction,
            lead_id: 0,
            segment: result.segment,
            priority: result.priority,
            is_duplicate: isDuplicate,
            duplicate_info: topDuplicate,
            show_review_question: true
          }
        });

        const hasServices = result.extraction.services && result.extraction.services.length > 0;

        if (hasServices) {
          // Services found — go straight to confirmation
          setTimeout(() => {
            addMessage({
              sender: "system",
              text: "Is everything correct, or would you like to edit any details?",
              extractedData: {
                ...result.extraction,
                lead_id: 0,
                segment: result.segment,
                priority: result.priority,
                is_duplicate: isDuplicate,
                duplicate_info: topDuplicate,
                awaiting_confirmation: true
              }
            });
          }, 500);
        } else {
          // No services — prompt user to enter at least one before saving
          setServicesPromptList([]);
          setServicesPromptInput('');
          setTimeout(() => {
            addMessage({
              sender: "system",
              text: "Services / products were not found on the card.\nPlease enter at least one service (or choose \"Other\" if unknown):",
              showServicesPrompt: true
            });
          }, 500);
        }
      } else {
        addMessage({
          sender: "system",
          text: "Failed to extract card details. Please try again."
        });
      }

    } catch (error) {
      console.error('Extraction failed:', error);
      addMessage({
        sender: "system",
        text: "❌ Failed to extract card details. Please try again."
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Confirm and save lead after user reviews
  const handleConfirmLead = async () => {
    if (!pendingCardConfirmation) return;

    setIsProcessing(true);
    try {
      const result = await api.confirmAndSaveLead(
        pendingCardConfirmation.extraction,
        exhibition?.exhibition_id || 1,
        employee?.employee_id || 1,
        pendingCardConfirmation.tempId
      );

      if (result.lead_id) {
        setPendingCardConfirmation(null);
        addMessage({
          sender: "system",
          text: `Lead saved. You can view or edit this lead from the Leads page.`,
          extractedData: {
            ...result.extraction,
            lead_id: result.lead_id,
            saved: true
          }
        });
      }
    } catch (error) {
      console.error('Failed to save lead:', error);
      addMessage({
        sender: "system",
        text: "Failed to save lead. Please try again."
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Cancel lead confirmation
  const handleCancelLead = () => {
    setPendingCardConfirmation(null);
    addMessage({
      sender: "system",
      text: "Scan cancelled. Upload another card to try again."
    });
  };

  // Services prompt: add a single tag
  const handleServicesPromptAdd = (text?: string) => {
    const val = (text ?? servicesPromptInput).trim();
    if (!val) return;
    if (!servicesPromptList.includes(val)) {
      setServicesPromptList(prev => [...prev, val]);
    }
    setServicesPromptInput('');
  };

  // Services prompt: proceed to confirmation
  const handleServicesPromptContinue = () => {
    if (!pendingCardConfirmation || servicesPromptList.length === 0) return;

    const updatedExtraction = {
      ...pendingCardConfirmation.extraction,
      services: servicesPromptList
    };
    setPendingCardConfirmation({ ...pendingCardConfirmation, extraction: updatedExtraction });

    addMessage({ sender: 'employee', text: `Services: ${servicesPromptList.join(', ')}` });

    const fmtSeg = (s?: string) => s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'N/A';
    const fmtPri = (p?: string) => p ? p.charAt(0).toUpperCase() + p.slice(1) : 'N/A';
    const ext = updatedExtraction;

    addMessage({
      sender: 'system',
      text: `Updated summary:

Name: ${ext.persons?.[0]?.name || 'N/A'}
Company: ${ext.company_name || 'N/A'}
Phone: ${ext.phones?.[0] || 'N/A'}
Email: ${ext.emails?.[0] || 'N/A'}
Services: ${servicesPromptList.join(', ')}

Segment: ${fmtSeg(pendingCardConfirmation.extraction.segment)}  ·  Priority: ${fmtPri(pendingCardConfirmation.extraction.priority)}`
    });

    setTimeout(() => {
      addMessage({
        sender: 'system',
        text: 'Is everything correct, or would you like to edit any details?',
        extractedData: {
          ...updatedExtraction,
          lead_id: 0,
          segment: pendingCardConfirmation.extraction.segment,
          priority: pendingCardConfirmation.extraction.priority,
          awaiting_confirmation: true
        }
      });
    }, 400);
  };

  const handleSaveLead = async () => {
    // Get the lead ID from the last extracted message
    const lastExtractedMsg = messages.slice().reverse().find(m => m.extractedData?.lead_id);
    const leadId = lastExtractedMsg?.extractedData?.lead_id;

    if (!leadId) {
      addMessage({
        sender: "system",
        text: "Could not find lead ID. Please try scanning again."
      });
      return;
    }

    addMessage({
      sender: "employee",
      text: "✅ Confirmed - All details are correct"
    });

    addMessage({
      sender: "system",
      text: "Lead saved. You can record a voice note, upload another card, or view this lead in the Leads tab."
    });
  };

  const handleCorrectionRequest = (leadId: number) => {
    addMessage({
      sender: "employee",
      text: "✏️ Need Correction"
    });

    addMessage({
      sender: "system",
      text: "Which field is incorrect?\nPlease select:",
      extractedData: {
        _correction_menu: true,
        lead_id: leadId
      }
    });
  };

  const handleFieldCorrection = (leadId: number, field: string) => {
    // Get pending extraction if this is a pre-save correction
    const extraction = leadId === 0 && pendingCardConfirmation
      ? pendingCardConfirmation.extraction
      : null;

    setCorrectionMode({ active: true, leadId, field, pendingExtraction: extraction });

    addMessage({
      sender: "employee",
      text: `Correcting: ${field}`
    });

    const fieldPrompts: Record<string, string> = {
      'Name': 'Enter the correct name:',
      'Company': 'Enter the correct company name:',
      'Phone': 'Enter the correct phone number:',
      'Email': 'Enter the correct email address:',
      'Designation': 'Enter the correct designation:',
      'Address': 'Enter the correct address:',
      'Services': 'Enter the correct services/products:',
      'Other': 'Please describe what needs to be corrected:'
    };

    addMessage({
      sender: "system",
      text: fieldPrompts[field] || 'Enter correction:'
    });
  };

  const handleCorrectionSubmit = async (correctionText: string) => {
    if (!correctionMode.active || !correctionMode.field) return;

    // First add the employee message with the correction
    addMessage({
      sender: "employee",
      text: correctionText
    });

    try {
      // If leadId is 0, we're correcting before save (updating pending extraction)
      if (correctionMode.leadId === 0 && correctionMode.pendingExtraction && pendingCardConfirmation) {
        // Update the pending extraction data
        const updatedExtraction = { ...correctionMode.pendingExtraction };

        // Map field names to extraction structure
        const fieldName = correctionMode.field.toLowerCase();

        if (fieldName === 'name') {
          if (!updatedExtraction.persons) updatedExtraction.persons = [];
          if (updatedExtraction.persons.length === 0) updatedExtraction.persons.push({ name: '', designation: '', phones: [], email: '' });
          updatedExtraction.persons[0].name = correctionText;
        } else if (fieldName === 'company') {
          updatedExtraction.company_name = correctionText;
        } else if (fieldName === 'phone') {
          updatedExtraction.phones = [correctionText];
        } else if (fieldName === 'email') {
          updatedExtraction.emails = [correctionText];
        } else if (fieldName === 'designation') {
          if (!updatedExtraction.persons) updatedExtraction.persons = [];
          if (updatedExtraction.persons.length === 0) updatedExtraction.persons.push({ name: '', designation: '', phones: [], email: '' });
          updatedExtraction.persons[0].designation = correctionText;
        } else if (fieldName === 'address') {
          updatedExtraction.addresses = correctionText;
        } else if (fieldName === 'services') {
          updatedExtraction.services = correctionText.split(',').map((s: string) => s.trim()).filter(Boolean);
        } else if (fieldName === 'other') {
          // Store "Other" corrections in discussion_summary
          const existingDiscussion = updatedExtraction.discussion_summary || '';
          updatedExtraction.discussion_summary = existingDiscussion
            ? `${existingDiscussion}\n\nAdditional notes: ${correctionText}`
            : `Additional notes: ${correctionText}`;
        }

        // Update pending confirmation
        setPendingCardConfirmation({
          ...pendingCardConfirmation,
          extraction: updatedExtraction
        });

        // Show updated details
        const segment = pendingCardConfirmation.extraction.segment || 'N/A';
        const priority = pendingCardConfirmation.extraction.priority || 'N/A';

        const _fmtSeg = (s?: string) => s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'N/A';
        const _fmtPri = (p?: string) => p ? p.charAt(0).toUpperCase() + p.slice(1) : 'N/A';

        addMessage({
          sender: "system",
          text: `✅ ${correctionMode.field} updated

Name: ${updatedExtraction.persons?.[0]?.name || 'N/A'}
Company: ${updatedExtraction.company_name || 'N/A'}
Phone: ${updatedExtraction.phones?.[0] || 'N/A'}
Email: ${updatedExtraction.emails?.[0] || 'N/A'}${updatedExtraction.services?.length ? `\nServices: ${updatedExtraction.services.join(', ')}` : ''}

Segment: ${_fmtSeg(segment)}  ·  Priority: ${_fmtPri(priority)}

Any other fields to correct?`,
          extractedData: {
            _correction_menu: true,
            _field_selection: true,
            _ask_more_corrections: true,
            lead_id: 0,
            ...updatedExtraction
          }
        });

        setCorrectionMode({ active: false, leadId: null, field: null, pendingExtraction: null });
        return;
      }

      // Otherwise, update existing saved lead
      if (!correctionMode.leadId) return;

      // Map field names to API field names
      const fieldMap: Record<string, string> = {
        'Name': 'primary_visitor_name',
        'Company': 'company_name',
        'Phone': 'primary_visitor_phone',
        'Email': 'primary_visitor_email',
        'Designation': 'primary_visitor_designation',
        'Address': 'address',
        'Services': 'services',
        'Other': 'discussion_summary',
      };

      const apiField = fieldMap[correctionMode.field];

      if (apiField) {
        // For "Other", append to existing discussion_summary
        if (correctionMode.field === 'Other') {
          const currentLead = await api.getLead(correctionMode.leadId);
          const existingDiscussion = currentLead.discussion_summary || '';
          await api.updateLead(correctionMode.leadId, {
            discussion_summary: existingDiscussion
              ? `${existingDiscussion}\n\nAdditional notes: ${correctionText}`
              : `Additional notes: ${correctionText}`
          });
        } else {
          // Update the lead with corrected field
          await api.updateLead(correctionMode.leadId, {
            [apiField]: correctionText
          });
        }

        addMessage({
          sender: "system",
          text: `✅ ${correctionMode.field} updated successfully!`
        });
      }

      setCorrectionMode({ active: false, leadId: null, field: null, pendingExtraction: null });
    } catch (error) {
      console.error('Failed to update field:', error);
      addMessage({
        sender: "system",
        text: "Failed to update. Please try again."
      });
    }
  };

  const handleSend = () => {
    if (!input.trim()) return;

    // If in correction mode, handle the correction
    if (correctionMode.active) {
      handleCorrectionSubmit(input);
      setInput("");
      return;
    }

    addMessage({
      sender: "employee",
      text: input
    });

    // Check if user is responding to "Which field would you like to correct?"
    const lastSystemMessage = [...messages].reverse().find(m => m.sender === "system");
    const isFieldSelectionResponse = lastSystemMessage?.text?.includes("Which field would you like to correct?");

    if (isFieldSelectionResponse && pendingCardConfirmation) {
      // User specified which field to correct
      const fieldName = input.trim().toLowerCase();

      // Map field names to user-friendly prompts
      const fieldPrompts: Record<string, string> = {
        'name': 'visitor name',
        'company': 'company name',
        'phone': 'phone number',
        'email': 'email address',
        'designation': 'designation/job title',
        'address': 'address',
        'service': 'services/products',
        'services': 'services/products'
      };

      const promptField = fieldPrompts[fieldName] || fieldName;

      setTimeout(() => {
        addMessage({
          sender: "system",
          text: `Please provide the correct ${promptField}:`
        });

        // Set correction mode
        setCorrectionMode({
          active: true,
          leadId: 0, // Not saved yet
          field: fieldName,
          pendingExtraction: pendingCardConfirmation.extraction
        });
      }, 500);
    }

    setInput("");
  };

  const handleMicToggle = async () => {
    if (!isRecording) {
      // Always pass null on /chat page - backend will extract lead name from voice
      // This allows scheduling meetings for ANY lead by mentioning their name
      const leadId = null;

      setCurrentLeadId(leadId);

      try {
        // Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        const chunks: Blob[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        recorder.onstop = async () => {
          // Clear timer
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }

          // Stop all tracks
          stream.getTracks().forEach(track => track.stop());

          const audioBlob = new Blob(chunks, { type: 'audio/webm' });
          setAudioChunks([]);

          addMessage({
            sender: "system",
            text: "🎤 Processing voice note..."
          });

          setIsProcessing(true);

          try {
            // Send to backend for transcription and analysis
            const result = await api.extractVoice(audioBlob, leadId, employee?.employee_id || 1);

            if (result.success) {
              // Check if we need lead confirmation
              if (result.requires_confirmation && result.possible_leads && result.possible_leads.length > 0) {
                // Multiple leads found - show selector
                addMessage({
                  sender: "system",
                  text: `🔍 Found ${result.possible_leads.length} leads matching "${result.extracted_lead_name}". Please select one:\n\n${result.possible_leads.map((lead, i) => `${i + 1}. ${lead.name}${lead.company_name ? ` (${lead.company_name})` : ''}`).join('\n')}\n\n📝 Summary: ${result.summary}`
                });
                setMessages(prev => prev.slice(0, -1)); // Remove processing message
                setIsProcessing(false);
                return;
              }

              if (result.requires_confirmation && (!result.possible_leads || result.possible_leads.length === 0)) {
                // No leads found
                addMessage({
                  sender: "system",
                  text: result.error || `No lead found matching "${result.extracted_lead_name}". Please upload their visiting card first or scan a card before adding a voice note.`
                });
                setMessages(prev => prev.slice(0, -1)); // Remove processing message
                setIsProcessing(false);
                return;
              }

              // Success - voice note saved
              if (result.transcript) {
                // Load all leads for selection (for modal display)
                const leadsData = await api.getLeads();
                setAvailableLeads(leadsData.leads || []);

                const finalLeadId = result.lead_id || leadId;
                const leadName = result.extracted_lead_name || 'the lead';

                // Show confirmation modal with all details
                setVoiceConfirmModal({
                  show: true,
                  transcript: result.transcript,
                  summary: result.summary || '',
                  segment: result.segment || 'general',
                  priority: result.priority || 'medium',
                  interestLevel: result.interest_level || 'warm',
                  selectedLeadId: finalLeadId ?? undefined,
                  mentionedLeadName: leadName
                });

                // Remove processing message
                setMessages(prev => prev.slice(0, -1));
              } else {
                addMessage({
                  sender: "system",
                  text: result.error || "Failed to process voice note."
                });
              }
            } else {
              addMessage({
                sender: "system",
                text: result.error || "❌ Failed to process voice note."
              });
            }
          } catch (error) {
            console.error('Voice processing error:', error);
            addMessage({
              sender: "system",
              text: "Failed to process voice note. Please try again."
            });
          } finally {
            setIsProcessing(false);
          }
        };

        setMediaRecorder(recorder);
        setAudioChunks([]);
        recorder.start();
        setIsRecording(true);
        setRecordingTime(0);

        // Start timer
        timerRef.current = setInterval(() => {
          setRecordingTime((prev) => prev + 1);
        }, 1000);

        addMessage({
          sender: "employee",
          voice: true,
          text: "Recording voice note…"
        });

      } catch (error) {
        console.error('Microphone access error:', error);
        addMessage({
          sender: "system",
          text: "Could not access microphone. Please check permissions."
        });
      }
    } else {
      // Stop recording
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
      setIsRecording(false);

      // Clear timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  // Handle voice analysis confirmation
  const handleConfirmVoiceAnalysis = async (confirmed: boolean, modifiedData?: {
    segment?: string;
    priority?: string;
  }) => {
    if (!pendingVoiceConfirmation) return;

    if (!confirmed) {
      // User rejected - clear pending
      setPendingVoiceConfirmation(null);
      addMessage({
        sender: "employee",
        text: "Analysis rejected"
      });
      addMessage({
        sender: "system",
        text: "Voice analysis discarded. You can record another voice note or manually update the lead."
      });
      return;
    }

    // Merge any modifications
    const finalData = {
      ...pendingVoiceConfirmation,
      ...modifiedData
    };

    setIsProcessing(true);

    try {
      await api.confirmVoiceAnalysis(finalData);

      addMessage({
        sender: "employee",
        text: "✅ Confirmed"
      });

      addMessage({
        sender: "system",
        text: `✅ Voice note saved.\n\nSegment: ${(finalData.segment || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}  ·  Priority: ${finalData.priority ? finalData.priority.charAt(0).toUpperCase() + finalData.priority.slice(1) : 'N/A'}`
      });

      setPendingVoiceConfirmation(null);
    } catch (error) {
      console.error('Confirmation error:', error);
      addMessage({
        sender: "system",
        text: "Failed to save analysis. Please try again."
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle segment/priority modification
  const handleModifyVoiceAnalysis = (field: 'segment' | 'priority', value: string) => {
    if (!pendingVoiceConfirmation) return;

    setPendingVoiceConfirmation({
      ...pendingVoiceConfirmation,
      [field]: value
    });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!employee) {
    return null;
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-slate-50">

      {/* ── HEADER ── */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-4 py-3 z-10 md:min-h-[65px] flex items-center relative">
        <div className="flex items-center gap-3 w-full">
          {/* Back */}
          <motion.button
            whileTap={{ scale: 0.93 }}
            onClick={() => router.push('/dashboard')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
          >
            <ChevronLeft className="w-5 h-5" />
          </motion.button>

          {/* Title + Exhibition selector */}
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide leading-none mb-0.5">
              Card Scanner
            </p>
            <button
              onClick={() => setShowExhibitionPicker(!showExhibitionPicker)}
              className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 hover:text-blue-600 transition-colors group"
            >
              <Building2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500 shrink-0" />
              <span className="truncate">{exhibition?.name || 'Select Exhibition'}</span>
              <ChevronDown className={cn(
                'w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200',
                showExhibitionPicker && 'rotate-180'
              )} />
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 shrink-0">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleClearChat}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              title="Clear chat"
            >
              <Trash2 className="w-4 h-4" />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowLogoutConfirm(true)}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </motion.button>
            <div className="ml-1 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">
              {(employee.full_name || 'U')[0].toUpperCase()}
            </div>
          </div>
        </div>

        {/* Exhibition Picker Dropdown */}
        <AnimatePresence>
          {showExhibitionPicker && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full left-0 right-0 z-50 bg-white border-x border-b border-slate-200 rounded-b-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto"
            >
              {exhibitions.map((exh) => (
                <button
                  key={exh.exhibition_id}
                  onClick={() => { setExhibition(exh); setShowExhibitionPicker(false); }}
                  className={cn(
                    'w-full text-left px-4 py-2.5 text-sm transition-colors',
                    exhibition?.exhibition_id === exh.exhibition_id
                      ? 'bg-blue-50 text-blue-700 font-semibold'
                      : 'text-slate-700 hover:bg-slate-50'
                  )}
                >
                  {exh.name}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── MESSAGES ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-2">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className={cn('flex', msg.sender === 'employee' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[85%] px-4 py-3 rounded-2xl shadow-sm text-sm',
                  msg.sender === 'employee'
                    ? 'bg-blue-100 text-blue-900 rounded-br-none'
                    : 'bg-white text-slate-800 rounded-bl-none border border-slate-200'
                )}
              >
                {/* Image preview */}
                {msg.image && msg.image !== '[Image]' && (
                  <img src={msg.image} alt="Card" className="rounded-lg mb-2 max-w-full max-h-48 object-contain" />
                )}
                {msg.image === '[Image]' && (
                  <div className="bg-slate-100 rounded-lg px-4 py-3 mb-2 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                    <Camera className="w-4 h-4" /> Image not cached
                  </div>
                )}

                {/* Text */}
                {msg.text && <p className="whitespace-pre-line leading-relaxed">{msg.text}</p>}

                {/* ── Confirmation buttons ── */}
                {msg.extractedData && !msg.extractedData._correction_menu && msg.extractedData.awaiting_confirmation && (
                  <div className="mt-3 space-y-2">
                    <div className="flex gap-2">
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={() => {
                          if (msg.extractedData.is_duplicate) {
                            addMessage({
                              sender: 'system',
                              text: `Cannot save — this lead already exists.\n\nExisting Lead #${msg.extractedData.duplicate_info?.lead_id}\nName: ${msg.extractedData.duplicate_info?.visitor_name || 'N/A'}\nCompany: ${msg.extractedData.duplicate_info?.company_name || 'N/A'}\nPhone: ${msg.extractedData.duplicate_info?.phone || 'N/A'}\nSimilarity: ${msg.extractedData.duplicate_info?.similarity_score}%\n\nCancel this scan or edit the details.`,
                            });
                            return;
                          }
                          handleConfirmLead();
                        }}
                        disabled={isProcessing || msg.extractedData.is_duplicate}
                        className={cn(
                          'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                          msg.extractedData.is_duplicate
                            ? 'bg-slate-100 text-slate-400'
                            : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        )}
                      >
                        <Check className="w-4 h-4" />
                        {msg.extractedData.is_duplicate ? 'Duplicate' : isProcessing ? 'Saving…' : 'Everything Correct'}
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={() => addMessage({
                          sender: 'system',
                          text: 'Which field is incorrect? Select below:',
                          extractedData: { _correction_menu: true, _field_selection: true, lead_id: 0, ...msg.extractedData },
                        })}
                        disabled={isProcessing}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-amber-100 text-amber-700 text-sm font-semibold hover:bg-amber-200 transition-colors disabled:opacity-50"
                      >
                        <Edit2 className="w-4 h-4" />
                        Edit Details
                      </motion.button>
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={handleCancelLead}
                      disabled={isProcessing}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-100 text-red-700 text-sm font-semibold hover:bg-red-200 transition-colors disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                      Cancel &amp; Discard
                    </motion.button>
                  </div>
                )}

                {/* ── View/Edit button after save ── */}
                {msg.extractedData && !msg.extractedData._correction_menu && !msg.extractedData.awaiting_confirmation && msg.extractedData.lead_id > 0 && (
                  <div className="mt-3">
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => router.push(`/leads/${msg.extractedData.lead_id}`)}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-blue-100 text-blue-700 text-sm font-semibold hover:bg-blue-200 transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                      Edit Details
                    </motion.button>
                  </div>
                )}

                {/* ── Field correction grid ── */}
                {msg.extractedData && msg.extractedData._correction_menu && !msg.extractedData._ask_more_corrections && (
                  <div className="mt-3 grid grid-cols-2 gap-1.5">
                    {['Name', 'Company', 'Phone', 'Email', 'Designation', 'Address', 'Services', 'Other'].map((field) => (
                      <motion.button
                        key={field}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => handleFieldCorrection(msg.extractedData.lead_id, field)}
                        className="py-2 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-700 transition-colors"
                      >
                        {field}
                      </motion.button>
                    ))}
                  </div>
                )}

                {/* ── Ask more corrections ── */}
                {msg.extractedData && msg.extractedData._ask_more_corrections && (
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      {['Name', 'Company', 'Phone', 'Email', 'Designation', 'Address', 'Services', 'Other'].map((field) => (
                        <motion.button
                          key={field}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleFieldCorrection(msg.extractedData.lead_id, field)}
                          className="py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-colors"
                        >
                          {field}
                        </motion.button>
                      ))}
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={handleConfirmLead}
                      disabled={isProcessing}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-100 text-emerald-700 text-sm font-semibold hover:bg-emerald-200 transition-colors disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" />
                      {isProcessing ? 'Saving…' : 'All Good — Save Lead'}
                    </motion.button>
                  </div>
                )}

                {/* ── Two-sided card ── */}
                {msg.showBackSidePrompt && twoSidedMode.awaitingBackSide && (
                  <div className="mt-3 flex gap-2">
                    <motion.button whileTap={{ scale: 0.97 }} onClick={handleHasBackSide}
                      className="flex-1 py-2.5 rounded-xl bg-blue-100 text-blue-700 text-sm font-semibold hover:bg-blue-200 transition-colors">
                      Yes, has back side
                    </motion.button>
                    <motion.button whileTap={{ scale: 0.97 }} onClick={handleNoBackSide}
                      className="flex-1 py-2.5 rounded-xl bg-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-300 transition-colors">
                      No back side
                    </motion.button>
                  </div>
                )}
                {msg.showBackUploadButton && twoSidedMode.active && (
                  <div className="mt-3 flex gap-2">
                    <motion.button whileTap={{ scale: 0.97 }} onClick={() => handleTakePhoto(true)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-blue-100 text-blue-700 text-sm font-semibold hover:bg-blue-200 transition-colors">
                      <Camera className="w-4 h-4" />
                      Take Photo
                    </motion.button>
                    <motion.button whileTap={{ scale: 0.97 }} onClick={() => backGalleryInputRef.current?.click()}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-semibold hover:bg-slate-200 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
                      </svg>
                      From Gallery
                    </motion.button>
                  </div>
                )}

                {/* ── Services prompt (mandatory) ── */}
                {msg.showServicesPrompt && pendingCardConfirmation && (
                  <div className="mt-3 space-y-2">
                    {/* Tag chips */}
                    {servicesPromptList.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {servicesPromptList.map((s) => (
                          <span
                            key={s}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full"
                          >
                            {s}
                            <button
                              onClick={() => setServicesPromptList(prev => prev.filter(x => x !== s))}
                              className="hover:text-blue-900"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Text input + Add */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g. Steel pipes, Valves…"
                        value={servicesPromptInput}
                        onChange={e => setServicesPromptInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleServicesPromptAdd()}
                        className="flex-1 min-w-0 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-all"
                      />
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => handleServicesPromptAdd()}
                        disabled={!servicesPromptInput.trim()}
                        className="px-3 py-2 bg-blue-100 text-blue-700 text-xs font-semibold rounded-xl hover:bg-blue-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Add
                      </motion.button>
                    </div>
                    {/* Quick pick: Other */}
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleServicesPromptAdd('Other')}
                      className="w-full py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition-colors"
                    >
                      + Other (unknown)
                    </motion.button>
                    {/* Continue */}
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={handleServicesPromptContinue}
                      disabled={servicesPromptList.length === 0}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-100 text-emerald-700 text-sm font-semibold hover:bg-emerald-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Check className="w-4 h-4" />
                      Continue
                    </motion.button>
                    {/* Cancel */}
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={handleCancelLead}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-100 text-red-700 text-xs font-semibold hover:bg-red-200 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancel &amp; Discard
                    </motion.button>
                  </div>
                )}

                {/* ── Voice analysis inline ── */}
                {msg.voiceAnalysis && pendingVoiceConfirmation && msg.voiceAnalysis.lead_id === pendingVoiceConfirmation.lead_id && (
                  <div className="mt-3 space-y-3 pt-3 border-t border-white/20">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Segment</p>
                      <div className="flex flex-wrap gap-1.5">
                        {['decision_maker', 'influencer', 'researcher', 'general'].map((seg) => (
                          <button
                            key={seg}
                            onClick={() => handleModifyVoiceAnalysis('segment', seg)}
                            className={cn(
                              'px-2.5 py-1 text-xs rounded-lg font-medium transition-colors capitalize',
                              pendingVoiceConfirmation.segment === seg
                                ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            )}
                          >
                            {seg.replace('_', ' ')}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Priority</p>
                      <div className="flex gap-1.5">
                        {[
                          { val: 'high', active: 'bg-red-100 text-red-700 ring-1 ring-red-300' },
                          { val: 'medium', active: 'bg-amber-100 text-amber-700 ring-1 ring-amber-300' },
                          { val: 'low', active: 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300' },
                        ].map(({ val, active }) => (
                          <button
                            key={val}
                            onClick={() => handleModifyVoiceAnalysis('priority', val)}
                            className={cn(
                              'flex-1 py-1 text-xs rounded-lg font-medium transition-colors capitalize',
                              pendingVoiceConfirmation.priority === val
                                ? active
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            )}
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <motion.button whileTap={{ scale: 0.97 }} onClick={() => handleConfirmVoiceAnalysis(true)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-100 text-emerald-700 text-sm font-semibold hover:bg-emerald-200 transition-colors">
                        <Check className="w-4 h-4" /> Confirm
                      </motion.button>
                      <motion.button whileTap={{ scale: 0.97 }} onClick={() => handleConfirmVoiceAnalysis(false)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-100 text-red-700 text-sm font-semibold hover:bg-red-200 transition-colors">
                        <X className="w-4 h-4" /> Reject
                      </motion.button>
                    </div>
                  </div>
                )}

                {/* Timestamp */}
                <p className={cn('text-[11px] mt-1.5', msg.sender === 'employee' ? 'text-blue-400' : 'text-slate-400')}>
                  {new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Processing — typing dots */}
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm flex items-center gap-1.5">
              {[0, 150, 300].map((delay) => (
                <div
                  key={delay}
                  className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          </motion.div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* ── INPUT BAR ── */}
      <div className="shrink-0 bg-white border-t border-slate-200">
        {/* Hidden file inputs */}
        <input ref={cameraInputRef} type="file" className="hidden" accept="image/*" capture="environment" onChange={handleImageUpload} />
        <input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
        <input ref={backImageInputRef} type="file" className="hidden" accept="image/*" capture="environment" onChange={handleBackImageUpload} />
        <input ref={backGalleryInputRef} type="file" className="hidden" accept="image/*" onChange={handleBackImageUpload} />
        <canvas ref={canvasRef} className="hidden" />

        <AnimatePresence mode="wait">
          {isRecording ? (
            <motion.div
              key="recording"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-3 px-4 py-3 bg-red-50"
            >
              {/* Pulse dot + label */}
              <div className="flex items-center gap-2 shrink-0">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
                <span className="text-xs font-bold text-red-600 tracking-wide">REC</span>
              </div>

              {/* Waveform bars */}
              <div className="flex-1 flex items-center justify-center gap-0.5 h-8">
                {[...Array(28)].map((_, i) => (
                  <div
                    key={i}
                    className="bg-red-400 rounded-full animate-waveform"
                    style={{ width: '2px', minHeight: '4px', animationDelay: `${i * 0.05}s`, animationDuration: `${0.6 + (i % 3) * 0.2}s` }}
                  />
                ))}
              </div>

              {/* Timer */}
              <span className="text-sm font-mono font-bold text-red-700 shrink-0 tabular-nums">
                {formatTime(recordingTime)}
              </span>

              {/* Stop */}
              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={handleMicToggle}
                className="shrink-0 w-9 h-9 flex items-center justify-center bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
              >
                <Mic className="w-4 h-4" />
              </motion.button>
            </motion.div>
          ) : (
            <motion.div
              key="input"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 px-3 py-2.5"
            >
              {/* Plus (upload) */}
              <div className="relative shrink-0">
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowUploadOptions(!showUploadOptions)}
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                </motion.button>

                <AnimatePresence>
                  {showUploadOptions && (
                    <motion.div
                      initial={{ opacity: 0, y: 4, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.97 }}
                      transition={{ duration: 0.15 }}
                      className="absolute bottom-full left-0 mb-2 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden min-w-[190px]"
                    >
                      <button
                        onClick={() => { setShowUploadOptions(false); handleTakePhoto(false); }}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors w-full text-left"
                      >
                        <Camera className="w-4 h-4 text-blue-600 shrink-0" />
                        <span className="text-sm font-medium text-slate-700">Take Photo</span>
                      </button>
                      <button
                        onClick={() => { fileInputRef.current?.click(); setShowUploadOptions(false); }}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors w-full text-left border-t border-slate-100"
                      >
                        <Plus className="w-4 h-4 text-blue-600 shrink-0" />
                        <span className="text-sm font-medium text-slate-700">Upload from Gallery</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Mic */}
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleMicToggle}
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <Mic className="w-5 h-5" />
              </motion.button>

              {/* Text input */}
              <input
                type="text"
                placeholder="Type a message…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                className="flex-1 min-w-0 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition-all"
              />

              {/* Send */}
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleSend}
                disabled={!input.trim()}
                className={cn(
                  'shrink-0 w-9 h-9 flex items-center justify-center rounded-xl transition-colors',
                  input.trim()
                    ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                    : 'bg-slate-100 text-slate-300 cursor-not-allowed'
                )}
              >
                <Send className="w-4 h-4" />
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Spacer for mobile BottomNav */}
      <div className="md:hidden shrink-0 h-16" />

      {/* ── VOICE MODAL ── */}
      <AnimatePresence>
        {voiceConfirmModal.show && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4 sm:p-6"
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden"
            >
              {/* Modal header */}
              <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between shrink-0">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Voice Note Details</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Review and confirm extracted information</p>
                </div>
                <button
                  onClick={() => setVoiceConfirmModal({ ...voiceConfirmModal, show: false })}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal body */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {/* Linked lead */}
                {voiceConfirmModal.selectedLeadId && (() => {
                  const leadInfo = availableLeads.find(l => l.lead_id === voiceConfirmModal.selectedLeadId);
                  return leadInfo && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Linked Lead</p>
                      <p className="text-sm font-semibold text-slate-800">
                        #{leadInfo.lead_id}{leadInfo.primary_visitor_name && ` · ${leadInfo.primary_visitor_name}`}{leadInfo.company_name && ` · ${leadInfo.company_name}`}
                      </p>
                    </div>
                  );
                })()}

                {/* Summary */}
                {voiceConfirmModal.summary && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Summary</p>
                    <p className="text-sm text-slate-700 leading-relaxed">{voiceConfirmModal.summary}</p>
                  </div>
                )}

                {/* Metadata */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Segment', value: voiceConfirmModal.segment },
                    { label: 'Priority', value: voiceConfirmModal.priority },
                    { label: 'Interest', value: voiceConfirmModal.interestLevel },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 text-center">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                      <p className="text-sm font-semibold text-slate-800 mt-0.5 capitalize">{value || '—'}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Modal footer */}
              <div className="px-6 py-4 border-t border-slate-200 flex gap-3 shrink-0">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setVoiceConfirmModal({ ...voiceConfirmModal, show: false })}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors"
                >
                  Discard
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    const leadInfo = voiceConfirmModal.selectedLeadId
                      ? availableLeads.find(l => l.lead_id === voiceConfirmModal.selectedLeadId)
                      : null;
                    addMessage({
                      sender: 'system',
                      text: `Voice note saved.\n\n` +
                        (leadInfo ? `Lead: ${leadInfo.company_name || ''}${leadInfo.primary_visitor_name ? ` (${leadInfo.primary_visitor_name})` : ''}\n\n` : '') +
                        `${voiceConfirmModal.summary || voiceConfirmModal.transcript}\n\n` +
                        `Segment: ${voiceConfirmModal.segment} · Priority: ${voiceConfirmModal.priority} · Interest: ${voiceConfirmModal.interestLevel}`,
                    });
                    setVoiceConfirmModal({ ...voiceConfirmModal, show: false });
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-100 text-emerald-700 text-sm font-semibold hover:bg-emerald-200 transition-colors"
                >
                  Confirm &amp; Save
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Clear Chat Confirm Modal ── */}
      <AnimatePresence>
        {showClearConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[100]"
            onClick={() => setShowClearConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-72 p-5 flex flex-col gap-4"
            >
              <p className="text-sm font-bold text-slate-900">Clear all chat messages?</p>
              <p className="text-xs text-slate-500">This will remove all messages from this session.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 py-2 text-xs font-semibold border border-slate-200 rounded-xl hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmClearChat}
                  className="flex-1 py-2 text-xs font-semibold bg-red-500 text-white rounded-xl hover:bg-red-600 transition"
                >
                  Clear
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Logout Confirm Modal ── */}
      <AnimatePresence>
        {showLogoutConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[100]"
            onClick={() => setShowLogoutConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-72 p-5 flex flex-col gap-4"
            >
              <p className="text-sm font-bold text-slate-900">Log out?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 py-2 text-xs font-semibold border border-slate-200 rounded-xl hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { setShowLogoutConfirm(false); logout(); }}
                  className="flex-1 py-2 text-xs font-semibold bg-red-500 text-white rounded-xl hover:bg-red-600 transition"
                >
                  Logout
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Webcam Modal (desktop camera) ── */}
      {webcamOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-4">
          <div className="bg-black rounded-2xl overflow-hidden w-full max-w-lg shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-black/60">
              <span className="text-white font-semibold text-sm">Camera</span>
              <button onClick={closeWebcam} className="text-white/70 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Camera selector (shown only when multiple cameras) */}
            {videoDevices.length > 1 && (
              <div className="px-4 py-2 bg-black/40">
                <select
                  value={selectedDeviceId}
                  onChange={e => switchCamera(e.target.value)}
                  className="w-full text-xs bg-white/10 text-white border border-white/20 rounded-lg px-3 py-1.5 focus:outline-none"
                >
                  {videoDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId} className="bg-slate-800">
                      {d.label || `Camera ${videoDevices.indexOf(d) + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Live preview */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full aspect-video object-cover bg-black"
            />

            {/* Shutter */}
            <div className="flex justify-center py-4 bg-black">
              <button
                onClick={captureWebcam}
                className="w-16 h-16 rounded-full bg-white border-4 border-slate-300 hover:scale-105 active:scale-95 transition-transform flex items-center justify-center shadow-lg"
              >
                <Camera className="w-7 h-7 text-slate-800" />
              </button>
            </div>
          </div>
          <p className="text-white/50 text-xs mt-3">
            {videoDevices.length > 1 ? `${videoDevices.length} cameras detected · select above` : 'Click to capture'}
          </p>
        </div>
      )}
    </div>
  );
}
