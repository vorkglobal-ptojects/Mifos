import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Camera, AlertCircle, RefreshCw, Activity, PackageSearch, CheckCircle2, ZoomIn, Eye } from 'lucide-react';
import { WebcamCapture } from './WebcamCapture';
import { getAuthHeaders } from '@/lib/getAuthHeaders';

export interface EvaluationResult {
  airWeight: number;
  waterWeight: number;
  askingAmount: number;
  trueValue: number;
  airWeightPhoto?: string | null;
  waterWeightPhoto?: string | null;
  specificGravity?: number;
  estimatedKarat?: string;
}

export function getEstimatedPurity(sg: number): string {
  if (sg >= 19.1) return '24K (Pure Gold)';
  if (sg >= 17.2) return '22K (91.6% Sovereign)';
  if (sg >= 16.2) return '21K (87.5% Gold)';
  if (sg >= 15.4) return '20K (83.3% Gold)';
  if (sg >= 14.4) return '18K (75.0% Gold)';
  if (sg >= 12.5) return '14K (58.5% Gold)';
  if (sg >= 11.2) return '10K (41.7% Gold)';
  if (sg >= 10.5) return '9K (37.5% Gold)';
  if (sg >= 9.5)  return 'Silver / Low Karat';
  if (sg >= 8.0)  return 'Brass / Copper Alloy';
  if (sg >= 6.5)  return 'Iron / Steel Alloy';
  if (sg > 0)     return 'Base Metal / Non-Gold';
  return 'Unknown';
}

interface ItemEvaluationModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: (data: EvaluationResult) => void;
}

export function ItemEvaluationModal({ isOpen, onOpenChange, onAccept }: ItemEvaluationModalProps) {
  const [mode, setMode] = useState<'AUTO' | 'MANUAL'>('MANUAL');
  const [airWeight, setAirWeight] = useState<string>('');
  const [waterWeight, setWaterWeight] = useState<string>('');
  const [askingAmount, setAskingAmount] = useState<string>('');
  const [trueValue, setTrueValue] = useState<string>('');
  
  const [specificGravity, setSpecificGravity] = useState<number>(0);
  const [estimatedKarat, setEstimatedKarat] = useState<string>('Unknown');
  
  const [showWebcam, setShowWebcam] = useState<boolean>(false);
  const [captureTarget, setCaptureTarget] = useState<'AIR' | 'WATER' | null>(null);
  
  const [airWeightPhoto, setAirWeightPhoto] = useState<string | null>(null);
  const [waterWeightPhoto, setWaterWeightPhoto] = useState<string | null>(null);
  const [previewScalePhoto, setPreviewScalePhoto] = useState<{ url: string; title: string; target: 'AIR' | 'WATER' } | null>(null);

  const [isProcessingOcr, setIsProcessingOcr] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);

  // Calculate SG when weights change
  useEffect(() => {
    const rawAw = parseFloat(airWeight);
    const rawWw = parseFloat(waterWeight);
    
    if (isNaN(rawAw) || isNaN(rawWw) || rawAw <= 0 || rawWw <= 0) {
      setSpecificGravity(0);
      setEstimatedKarat('Unknown');
      return;
    }

    let sg = 0;
    // Check if water weight is direct displaced water weight (beaker on tared scale)
    if (rawWw < rawAw * 0.45 && rawWw > 0) {
      sg = rawAw / rawWw;
    } else {
      // Submerged apparent weight method
      const maxW = Math.max(rawAw, rawWw);
      const minW = Math.min(rawAw, rawWw);
      const loss = maxW - minW;
      if (loss > 0) {
        sg = maxW / loss;
      }
    }

    if (sg > 0 && isFinite(sg)) {
      const roundedSg = parseFloat(sg.toFixed(2));
      setSpecificGravity(roundedSg);
      const purity = getEstimatedPurity(roundedSg);
      setEstimatedKarat(purity);
    } else {
      setSpecificGravity(0);
      setEstimatedKarat(Math.abs(rawAw - rawWw) < 0.0001 ? 'Equal weights (loss = 0)' : 'Unknown');
    }
  }, [airWeight, waterWeight]);

  const handleCapture = async (base64Img: string) => {
    setShowWebcam(false);
    
    if (captureTarget === 'AIR') {
      setAirWeightPhoto(base64Img);
      if (mode === 'AUTO') processOCR(base64Img, setAirWeight);
    } else if (captureTarget === 'WATER') {
      setWaterWeightPhoto(base64Img);
      if (mode === 'AUTO') processOCR(base64Img, setWaterWeight);
    }
    setCaptureTarget(null);
  };

  const processOCR = async (imgData: string, setter: (val: string) => void) => {
    setIsProcessingOcr(true);
    setOcrError(null);
    try {
      // Dynamically import tesseract to prevent Next.js Out-Of-Memory errors during bundling
      const Tesseract = (await import('tesseract.js')).default;
      
      // Using tesseract to read digits from the scale display
      const result = await (Tesseract.recognize as any)(imgData, 'eng', {
        tessedit_char_whitelist: '0123456789.', // Only numbers and decimal
      });
      
      const text = result.data.text.trim();
      // Basic regex to find a number in the text
      const match = text.match(/\d+(\.\d+)?/);
      
      if (match && match[0]) {
        setter(match[0]);
      } else {
        setOcrError("Could not read numbers clearly. Please enter manually.");
        setMode('MANUAL');
      }
    } catch (err) {
      console.error(err);
      setOcrError("OCR failed. Switching to manual mode.");
      setMode('MANUAL');
    } finally {
      setIsProcessingOcr(false);
    }
  };

  const openCamera = (target: 'AIR' | 'WATER') => {
    setCaptureTarget(target);
    setShowWebcam(true);
  };

  const handleReject = async () => {
    setIsRejecting(true);
    try {
      // Save rejection record and captured images into the database
      const res = await fetch('/api/evaluations', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          airWeight: parseFloat(airWeight) || 0,
          waterWeight: parseFloat(waterWeight) || 0,
          specificGravity,
          estimatedKarat,
          askingAmount: parseFloat(askingAmount) || 0,
          trueValue: parseFloat(trueValue) || 0,
          status: 'REJECTED',
          airWeightPhoto: airWeightPhoto || null,
          waterWeightPhoto: waterWeightPhoto || null,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to save rejection record');
      }

      alert("Item rejected and evaluation record stored in database.");
      resetForm();
      onOpenChange(false);
    } catch (err: any) {
      console.error("Error saving rejection:", err);
      alert(err.message || "Failed to save rejection record.");
    } finally {
      setIsRejecting(false);
    }
  };

  const handleAccept = async () => {
    setIsAccepting(true);
    try {
      // Store evaluation and captured air/water weight photos in the database
      const res = await fetch('/api/evaluations', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          airWeight: parseFloat(airWeight) || 0,
          waterWeight: parseFloat(waterWeight) || 0,
          specificGravity,
          estimatedKarat,
          askingAmount: parseFloat(askingAmount) || 0,
          trueValue: parseFloat(trueValue) || 0,
          status: 'ACCEPTED',
          airWeightPhoto: airWeightPhoto || null,
          waterWeightPhoto: waterWeightPhoto || null,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        console.warn("Evaluation save notice:", errJson);
      }
    } catch (err) {
      console.warn("Could not persist evaluation to API, proceeding:", err);
    } finally {
      setIsAccepting(false);
    }

    onAccept({
      airWeight: parseFloat(airWeight) || 0,
      waterWeight: parseFloat(waterWeight) || 0,
      askingAmount: parseFloat(askingAmount) || 0,
      trueValue: parseFloat(trueValue) || 0,
      airWeightPhoto,
      waterWeightPhoto,
      specificGravity,
      estimatedKarat,
    });
    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setAirWeight('');
    setWaterWeight('');
    setAskingAmount('');
    setTrueValue('');
    setAirWeightPhoto(null);
    setWaterWeightPhoto(null);
    setOcrError(null);
    setMode('MANUAL');
  };

  return (
    <Dialog open={isOpen} onOpenChange={(v) => { onOpenChange(v); if(!v) resetForm(); }}>
      <DialogContent className="sm:max-w-xl bg-white border border-slate-200 shadow-2xl p-0 rounded-2xl sm:rounded-[2.5rem] max-h-[90dvh] flex flex-col gap-0 overflow-hidden">
        <div className="h-2.5 bg-gradient-to-r from-amber-500 via-amber-600 to-yellow-500 shrink-0" />
        
        {showWebcam && captureTarget ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-6">
            <h3 className="text-lg font-bold mb-4 text-center pr-8">Capture {captureTarget === 'AIR' ? 'Air' : 'Water'} Weight</h3>
            <WebcamCapture 
              onCapture={handleCapture} 
              onClose={() => setShowWebcam(false)} 
              initialImage={captureTarget === 'AIR' ? airWeightPhoto : waterWeightPhoto}
            />
          </div>
        ) : (
          <>
            <div className="p-6 pb-3 border-b border-slate-100 shrink-0 pr-12">
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-amber-500/10 rounded-2xl text-amber-600">
                    <PackageSearch className="w-6 h-6" />
                  </div>
                  <DialogTitle className="text-2xl font-black text-slate-900">
                    Pawning Registration
                  </DialogTitle>
                </div>
                <DialogDescription className="font-semibold text-slate-500 text-sm mt-2">
                  Evaluate item weights, determine specific gravity, and calculate value before originating pawn.
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5 overscroll-contain">
              {/* Mode Toggle */}
              <div className="flex bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors cursor-pointer ${mode === 'MANUAL' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                  onClick={() => setMode('MANUAL')}
                >
                  Manual Mode
                </button>
                <button
                  type="button"
                  className={`flex-1 py-2 text-sm font-bold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2 ${mode === 'AUTO' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                  onClick={() => setMode('AUTO')}
                >
                  <Camera className="w-4 h-4" /> Auto (OCR) Mode
                </button>
              </div>

              {ocrError && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2 font-medium">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  {ocrError}
                </div>
              )}

              {/* Weights Input */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Air Weight (mg)</Label>
                    {airWeightPhoto && (
                      <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-0.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Photo saved
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2 items-center">
                    <Input 
                      type="number" 
                      value={airWeight}
                      onChange={(e) => setAirWeight(e.target.value)}
                      placeholder="e.g. 12500"
                      className="font-mono font-bold"
                    />
                    {airWeightPhoto ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setPreviewScalePhoto({ url: airWeightPhoto, title: 'Air Weight Scale Proof', target: 'AIR' })}
                          className="relative shrink-0 group rounded-lg overflow-hidden border-2 border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-black cursor-pointer shadow-sm"
                          title="Click to view full photo"
                        >
                          <img 
                            src={airWeightPhoto} 
                            alt="Air weight proof" 
                            className="w-10 h-10 object-contain" 
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <ZoomIn className="w-3.5 h-3.5 text-white" />
                          </div>
                        </button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          type="button"
                          onClick={() => openCamera('AIR')}
                          className="h-9 w-9 text-slate-500 hover:text-slate-800"
                          title="Retake Air Photo"
                        >
                          <Camera className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <Button 
                        variant="outline" 
                        size="icon" 
                        type="button"
                        onClick={() => openCamera('AIR')}
                        className="shrink-0"
                        title="Take Photo Proof"
                      >
                        <Camera className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Water Weight (mg)</Label>
                    {waterWeightPhoto && (
                      <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-0.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Photo saved
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2 items-center">
                    <Input 
                      type="number" 
                      value={waterWeight}
                      onChange={(e) => setWaterWeight(e.target.value)}
                      placeholder="e.g. 11800"
                      className="font-mono font-bold"
                    />
                    {waterWeightPhoto ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setPreviewScalePhoto({ url: waterWeightPhoto, title: 'Water Weight Scale Proof', target: 'WATER' })}
                          className="relative shrink-0 group rounded-lg overflow-hidden border-2 border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400 bg-black cursor-pointer shadow-sm"
                          title="Click to view full photo"
                        >
                          <img 
                            src={waterWeightPhoto} 
                            alt="Water weight proof" 
                            className="w-10 h-10 object-contain" 
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <ZoomIn className="w-3.5 h-3.5 text-white" />
                          </div>
                        </button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          type="button"
                          onClick={() => openCamera('WATER')}
                          className="h-9 w-9 text-slate-500 hover:text-slate-800"
                          title="Retake Water Photo"
                        >
                          <Camera className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <Button 
                        variant="outline" 
                        size="icon" 
                        type="button"
                        onClick={() => openCamera('WATER')}
                        className="shrink-0"
                        title="Take Photo Proof"
                      >
                        <Camera className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Calculations Display */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                    <Activity className="w-3 h-3" /> Specific Gravity
                  </div>
                  <div className="text-xl font-black text-slate-900 font-mono">
                    {specificGravity > 0 ? specificGravity.toFixed(2) : '0.00'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Estimated Purity
                  </div>
                  <div className="text-xl font-black text-amber-600">
                    {estimatedKarat}
                  </div>
                </div>
              </div>

              {/* Financial Inputs */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Customer Asking (Rs.)</Label>
                  <Input 
                    type="number" 
                    value={askingAmount}
                    onChange={(e) => setAskingAmount(e.target.value)}
                    placeholder="e.g. 50000"
                    className="font-mono font-bold text-lg h-12"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">True Value (Rs.)</Label>
                  <Input 
                    type="number" 
                    value={trueValue}
                    onChange={(e) => setTrueValue(e.target.value)}
                    placeholder="e.g. 55000"
                    className="font-mono font-bold text-lg h-12 border-amber-300 focus-visible:ring-amber-500"
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="p-4 sm:p-6 bg-slate-50 border-t border-slate-100 flex gap-3 shrink-0">
              <Button 
                variant="outline" 
                onClick={handleReject} 
                disabled={isRejecting || isAccepting || isProcessingOcr || (!airWeight && !waterWeight)}
                className="flex-1 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 font-bold h-12"
              >
                {isRejecting ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
                Reject
              </Button>
              <Button 
                onClick={handleAccept} 
                disabled={isRejecting || isAccepting || isProcessingOcr || !airWeight || !waterWeight || !trueValue}
                className="flex-[2] bg-[#ffd100] hover:bg-[#ffee32] text-[#202020] font-black h-12 text-base sm:text-lg shadow-lg shadow-amber-500/20"
              >
                {isAccepting ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
                Accept & Continue
              </Button>
            </div>
          </>
        )}

        {/* Scale Proof Enlarge Modal */}
        {previewScalePhoto && (
          <div 
            className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setPreviewScalePhoto(null)}
          >
            <div className="relative max-w-xl max-h-[85vh] bg-slate-900 border border-slate-700 rounded-2xl p-4 shadow-2xl flex flex-col items-center" onClick={e => e.stopPropagation()}>
              <div className="w-full flex items-center justify-between pb-2 border-b border-slate-800 text-white text-xs font-bold">
                <span>{previewScalePhoto.title}</span>
                <button 
                  type="button"
                  onClick={() => setPreviewScalePhoto(null)}
                  className="text-slate-400 hover:text-white px-2 py-1 rounded-lg"
                >
                  ✕ Close
                </button>
              </div>
              <img 
                src={previewScalePhoto.url} 
                alt={previewScalePhoto.title} 
                className="w-full max-h-[65vh] object-contain rounded-xl mt-3 bg-black" 
              />
              <div className="mt-4 flex gap-2 w-full justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const target = previewScalePhoto.target;
                    setPreviewScalePhoto(null);
                    openCamera(target);
                  }}
                  className="text-white border-white/20 hover:bg-white/10 gap-1.5 text-xs font-bold"
                >
                  <Camera className="w-4 h-4" /> Retake Photo
                </Button>
                <Button
                  type="button"
                  onClick={() => setPreviewScalePhoto(null)}
                  className="bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
