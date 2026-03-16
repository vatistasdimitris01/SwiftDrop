/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  FileText, 
  Image as ImageIcon, 
  Video, 
  File, 
  QrCode, 
  Copy, 
  Download, 
  X, 
  Loader2,
  ArrowLeft,
  Share2
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  collection, 
  addDoc, 
  getDoc, 
  doc, 
  Timestamp,
  getDocFromServer
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Error handling for Firestore
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type ContentType = 'text' | 'image' | 'video' | 'file';

interface ShareData {
  content: string;
  contentType: ContentType;
  fileName?: string;
  createdAt: any;
  expiresAt: any;
}

export default function App() {
  const [view, setView] = useState<'upload' | 'result' | 'viewer'>('upload');
  const [contentType, setContentType] = useState<ContentType>('text');
  const [textContent, setTextContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [shareId, setShareId] = useState<string | null>(null);
  const [sharedData, setSharedData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Connection test
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);

  // Check for share ID in URL on mount
  useEffect(() => {
    const getShareId = () => {
      // Try URLSearchParams first
      const params = new URLSearchParams(window.location.search);
      let id = params.get('id');
      
      // Fallback: manual regex check (sometimes search is empty on mobile redirects)
      if (!id) {
        const match = window.location.href.match(/[?&]id=([^&#]+)/);
        id = match ? match[1] : null;
      }
      
      // Check hash as well (some social apps move params to hash)
      if (!id && window.location.hash) {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        id = hashParams.get('id');
      }
      
      return id;
    };

    const id = getShareId();
    if (id) {
      // Small delay to ensure everything is initialized
      const timer = setTimeout(() => {
        loadSharedContent(id);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, []);

  const loadSharedContent = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      console.log('Loading shared content for ID:', id);
      const docRef = doc(db, 'shares', id);
      
      // Try to get from server directly to avoid cache issues on mobile
      let docSnap;
      try {
        docSnap = await getDocFromServer(docRef);
      } catch (serverErr) {
        console.warn('getDocFromServer failed, falling back to getDoc:', serverErr);
        docSnap = await getDoc(docRef);
      }
      
      if (docSnap.exists()) {
        const data = docSnap.data() as ShareData;
        console.log('Content loaded successfully:', data.contentType);
        // Check expiration
        const now = Timestamp.now();
        if (data.expiresAt.toMillis() < now.toMillis()) {
          setError('This link has expired (30 days limit).');
          setView('upload');
        } else {
          setSharedData(data);
          setShareId(id);
          setView('viewer');
        }
      } else {
        console.error('Document does not exist for ID:', id);
        setError('Content not found or has been deleted.');
        setView('upload');
      }
    } catch (err) {
      console.error('Error in loadSharedContent:', err);
      if (err instanceof Error && err.message.includes('permissions')) {
        handleFirestoreError(err, OperationType.GET, `shares/${id}`);
      } else {
        setError(`Failed to load content: ${err instanceof Error ? err.message : 'Unknown error'}`);
        setView('upload');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.size > 800000) { // ~800KB limit for base64 in Firestore
        setError('File too large. Max 800KB for this demo.');
        return;
      }
      setFile(selectedFile);
      setError(null);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  const handleUpload = async () => {
    setLoading(true);
    setError(null);
    try {
      let content = textContent;
      let finalContentType = contentType;
      let fileName = '';

      if (contentType !== 'text' && file) {
        content = await fileToBase64(file);
        fileName = file.name;
      }

      if (!content) {
        throw new Error('Please provide content or a file.');
      }

      const now = new Date();
      const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const docRef = await addDoc(collection(db, 'shares'), {
        content,
        contentType: finalContentType,
        fileName,
        createdAt: Timestamp.fromDate(now),
        expiresAt: Timestamp.fromDate(expires),
      });

      setShareId(docRef.id);
      setView('result');
    } catch (err: any) {
      if (err.code === 'permission-denied' || err.message?.includes('permissions')) {
        handleFirestoreError(err, OperationType.CREATE, 'shares');
      } else {
        console.error(err);
        setError(err.message || 'Failed to upload content.');
      }
    } finally {
      setLoading(false);
    }
  };

  const getBaseUrl = () => {
    const url = window.location.href.split(/[?#]/)[0];
    return url.endsWith('/') ? url : url + '/';
  };

  const shareUrl = shareId ? `${getBaseUrl()}?id=${shareId}` : '';

  const copyToClipboard = async () => {
    if (shareUrl) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        alert('Link copied to clipboard!');
      } catch (err) {
        // Fallback for browsers that don't support clipboard API or have issues
        const textArea = document.createElement("textarea");
        textArea.value = shareUrl;
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
          alert('Link copied to clipboard!');
        } catch (copyErr) {
          console.error('Fallback copy failed', copyErr);
        }
        document.body.removeChild(textArea);
      }
    }
  };

  const reset = () => {
    setView('upload');
    setShareId(null);
    setSharedData(null);
    setTextContent('');
    setFile(null);
    setError(null);
    window.history.replaceState({}, '', window.location.pathname);
  };

  if (loading && view === 'viewer') {
    return (
      <div className="min-h-screen bg-[#0a0502] flex items-center justify-center font-sans">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0502] text-[#e0d8d0] font-sans selection:bg-orange-500 selection:text-white relative overflow-hidden">
      {/* Atmosphere */}
      <div className="absolute inset-0 z-0 opacity-40">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#3a1510] blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#ff4e00] blur-[120px]" />
      </div>

      {/* Header */}
      <header className="p-8 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-3 cursor-pointer" onClick={reset}>
          <div className="w-10 h-10 bg-[#ff4e00]/20 backdrop-blur-md flex items-center justify-center rounded-full border border-[#ff4e00]/30">
            <QrCode className="text-[#ff4e00] w-5 h-5" />
          </div>
          <h1 className="text-xl font-light tracking-[0.2em] uppercase text-white">SwiftDrop</h1>
        </div>
        {view !== 'upload' && (
          <button 
            onClick={reset}
            className="flex items-center gap-2 text-xs font-medium hover:text-white uppercase tracking-widest text-[#e0d8d0]/60"
          >
            <Plus className="w-4 h-4" /> New
          </button>
        )}
      </header>

      <main className="max-w-2xl mx-auto p-6 md:py-12 relative z-10">
        {error && (
          <div className="mb-8 p-4 bg-red-900/20 border border-red-500/30 text-red-200 text-sm flex justify-between items-center backdrop-blur-md">
            <span>{error}</span>
            <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}

        {view === 'upload' && (
          <div className="space-y-12">
            <section>
              <h2 className="text-5xl font-serif font-light tracking-tight mb-12 text-white">Share something.</h2>
              
              {/* Type Selector */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                {[
                  { id: 'text', icon: FileText, label: 'Text' },
                  { id: 'image', icon: ImageIcon, label: 'Image' },
                  { id: 'video', icon: Video, label: 'Video' },
                  { id: 'file', icon: File, label: 'File' },
                ].map((type) => (
                  <button
                    key={type.id}
                    onClick={() => {
                      setContentType(type.id as ContentType);
                      setFile(null);
                    }}
                    className={cn(
                      "flex flex-col items-center justify-center p-6 transition-all backdrop-blur-md border rounded-2xl",
                      contentType === type.id 
                        ? "bg-[#ff4e00]/20 border-[#ff4e00]/50 text-white" 
                        : "bg-white/5 border-white/10 hover:bg-white/10 text-[#e0d8d0]/60"
                    )}
                  >
                    <type.icon className="w-6 h-6 mb-2" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">{type.label}</span>
                  </button>
                ))}
              </div>

              {/* Input Area */}
              <div className="bg-white/5 backdrop-blur-md border border-white/10 p-1 rounded-2xl">
                {contentType === 'text' ? (
                  <textarea
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    placeholder="Type your message here..."
                    className="w-full h-48 p-6 resize-none focus:outline-none text-lg bg-transparent text-white placeholder:text-[#e0d8d0]/30"
                  />
                ) : (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-48 border border-dashed border-white/20 flex flex-col items-center justify-center cursor-pointer hover:bg-white/5 transition-colors rounded-xl"
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange}
                      className="hidden"
                      accept={
                        contentType === 'image' ? 'image/*' : 
                        contentType === 'video' ? 'video/*' : 
                        '*'
                      }
                    />
                    {file ? (
                      <div className="text-center">
                        <p className="font-medium text-white text-lg">{file.name}</p>
                        <p className="text-xs opacity-50">{(file.size / 1024).toFixed(1)} KB</p>
                      </div>
                    ) : (
                      <>
                        <Plus className="w-8 h-8 mb-2 opacity-50" />
                        <p className="text-[10px] font-bold uppercase tracking-widest opacity-60">Select {contentType}</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </section>

            <button
              onClick={handleUpload}
              disabled={loading || (contentType === 'text' ? !textContent : !file)}
              className="w-full bg-white text-black py-6 font-bold uppercase tracking-[0.2em] hover:bg-white/90 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-3 rounded-full transition-all"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Generate QR Code'}
            </button>
            
            <p className="text-center text-[10px] uppercase tracking-widest opacity-40">
              All content expires automatically after 30 days.
            </p>
          </div>
        )}

        {view === 'result' && shareId && (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-4">
              <h2 className="text-4xl font-serif font-light text-white">Ready to share.</h2>
              <p className="text-sm opacity-50 uppercase tracking-widest">Scan the code or copy the link below.</p>
            </div>

            <div className="flex flex-col items-center gap-8">
              <div className="p-6 bg-white rounded-3xl shadow-2xl shadow-orange-500/10">
                <QRCodeSVG 
                  key={shareUrl}
                  value={shareUrl} 
                  size={256}
                  level="H"
                  includeMargin={false}
                  fgColor="#000000"
                  bgColor="#FFFFFF"
                  className="w-full h-auto max-w-[256px]"
                />
              </div>

              <div className="w-full space-y-4">
                <div className="flex bg-white/5 backdrop-blur-md border border-white/10 rounded-full overflow-hidden">
                  <input 
                    type="text" 
                    readOnly 
                    value={shareUrl}
                    className="flex-1 p-4 text-sm font-mono focus:outline-none bg-transparent text-white/70 px-6"
                  />
                  <button 
                    onClick={copyToClipboard}
                    className="px-6 bg-white text-black hover:bg-neutral-200 transition-colors"
                  >
                    <Copy className="w-5 h-5" />
                  </button>
                </div>
                
                <button 
                  onClick={() => {
                    if (navigator.share) {
                      navigator.share({
                        title: 'SwiftDrop',
                        url: shareUrl
                      }).catch(err => {
                        console.error('Share failed:', err);
                        copyToClipboard();
                      });
                    } else {
                      copyToClipboard();
                    }
                  }}
                  className="w-full border border-white/20 py-4 font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-white/5 transition-colors rounded-full"
                >
                  <Share2 className="w-4 h-4" /> Share Link
                </button>
              </div>
            </div>

            <div className="pt-8 border-t border-white/10">
              <button 
                onClick={reset}
                className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:text-white text-[#e0d8d0]/60"
              >
                <ArrowLeft className="w-3 h-3" /> Create another
              </button>
            </div>
          </div>
        )}

        {view === 'viewer' && sharedData && (
          <div className="space-y-12 animate-in fade-in duration-700">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] opacity-40">
                <span>Shared Content</span>
                <span>•</span>
                <span>Expires {new Date(sharedData.expiresAt.toMillis()).toLocaleDateString()}</span>
              </div>
              <h2 className="text-4xl font-serif font-light text-white">
                {sharedData.contentType === 'text' ? 'Message' : sharedData.fileName || 'File'}
              </h2>
            </div>

            <div className="bg-white/5 backdrop-blur-md border border-white/10 p-8 min-h-[300px] flex flex-col items-center justify-center rounded-3xl">
              {sharedData.contentType === 'text' && (
                <p className="w-full text-xl leading-relaxed whitespace-pre-wrap font-medium text-white/90">
                  {sharedData.content}
                </p>
              )}

              {sharedData.contentType === 'image' && (
                <img 
                  src={sharedData.content} 
                  alt="Shared" 
                  className="max-w-full max-h-[60vh] object-contain shadow-2xl rounded-2xl"
                  referrerPolicy="no-referrer"
                />
              )}

              {sharedData.contentType === 'video' && (
                <video 
                  src={sharedData.content} 
                  controls 
                  className="max-w-full max-h-[60vh] rounded-2xl"
                />
              )}

              {sharedData.contentType === 'file' && (
                <div className="text-center space-y-6">
                  <div className="w-24 h-24 bg-white/10 flex items-center justify-center mx-auto rounded-3xl">
                    <File className="w-12 h-12 text-white" />
                  </div>
                  <div>
                    <p className="text-2xl font-light tracking-tighter uppercase text-white">{sharedData.fileName}</p>
                    <p className="text-xs opacity-50 uppercase tracking-widest mt-1">Binary File</p>
                  </div>
                  <a 
                    href={sharedData.content} 
                    download={sharedData.fileName}
                    className="inline-flex items-center gap-2 bg-white text-black px-8 py-4 font-bold uppercase tracking-widest hover:bg-neutral-200 transition-colors rounded-full"
                  >
                    <Download className="w-4 h-4" /> Download File
                  </a>
                </div>
              )}
            </div>

            {sharedData.contentType !== 'file' && sharedData.contentType !== 'text' && (
              <a 
                href={sharedData.content} 
                download={sharedData.fileName || 'shared-content'}
                className="w-full border border-white/20 py-4 font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-white/5 transition-colors rounded-full"
              >
                <Download className="w-4 h-4" /> Download Original
              </a>
            )}

            <div className="pt-8 border-t border-white/10 flex justify-between items-center">
              <button 
                onClick={reset}
                className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:text-white text-[#e0d8d0]/60"
              >
                <Plus className="w-3 h-3" /> Create your own
              </button>
              
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => {
                    const canvas = document.querySelector('canvas');
                    if (canvas) {
                      const url = canvas.toDataURL('image/png');
                      const link = document.createElement('a');
                      link.download = 'qr-code.png';
                      link.href = url;
                      link.click();
                    }
                  }}
                  className="text-[10px] font-bold uppercase tracking-widest opacity-60 hover:opacity-100"
                >
                  Save QR
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto p-8 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] opacity-30">
          SwiftDrop • 30 Day Ephemeral Storage
        </p>
      </footer>
    </div>
  );
}
