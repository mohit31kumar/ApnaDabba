'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import { Delivery, getDeliveryById, skipDelivery } from '../../../services/customer/delivery.service';

export default function DeliverySchedulePage() {
 const { activeSubscriptionId } = useAuthStore();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<'LUNCH' | 'DINNER' | null>(null);
  // Use ${date}_${slot} as key when integrating API
  const [deliveryCache, setDeliveryCache] = useState<Record<string, Delivery>>({});;
  const [isFetchingDelivery, setIsFetchingDelivery] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [skipError, setSkipError] = useState<string | null>(null);
  const [skipSuccess, setSkipSuccess] = useState<boolean>(false);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [isSkipping, setIsSkipping] = useState<boolean>(false);
  

  useEffect(() => {
    if (!selectedDate || !selectedSlot) return;

    setSkipError(null);
    setSkipSuccess(false);

    const key = `${selectedDate}_${selectedSlot}`;
    
    // Guard prevents refetch loop when deliveryCache updates
    if (deliveryCache[key]) {
      return;
    }

    const fetchDelivery = async () => {
      setIsFetchingDelivery(true);
      setFetchError(null);
      
      try {
        const deliveryId = key; // temporary mapping
        const fetchedDelivery = await getDeliveryById(deliveryId);
        
        setDeliveryCache(prev => ({
          ...prev,
          [key]: fetchedDelivery
        }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to fetch delivery';
        setFetchError(message);
      } finally {
        setIsFetchingDelivery(false);
      }
    };

    fetchDelivery();
  }, [selectedDate, selectedSlot, deliveryCache, retryTrigger]);


  // TODO: Replace with subscription.start_date and end_date
  const startDate = new Date('2024-05-01');
  const endDate = new Date('2024-05-31');

  const firstDayOffset = startDate.getDay();
  
  // Prevent unused variable warning during skeleton phase
  console.debug('Current delivery cache size:', Object.keys(deliveryCache).length);
  
  const generateDateRange = (start: Date, end: Date) => {
    const dates = [];
    let currentDate = new Date(start);
    while (currentDate <= end) {
      dates.push(new Date(currentDate).toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    return dates;
  };

  const dates = generateDateRange(startDate, endDate);

  const cacheKey = `${selectedDate}_${selectedSlot}`;
  const delivery = deliveryCache[cacheKey];

  const isBeforeCutoff = (cutoffTime: string) => {
    const now = Date.now();
    const cutoff = new Date(cutoffTime).getTime();
    return now < cutoff;
  };

 const handleSkipDelivery = async () => {
    if (!delivery || !cacheKey) return;

    if (!isBeforeCutoff(delivery.cutoff_time)) {
      setSkipError('Skip not allowed: past cutoff time');
      return;
    }

    setIsSkipping(true);
    setSkipError(null);
    setSkipSuccess(false);


    try {
      await skipDelivery(delivery.id);

      setDeliveryCache(prev => ({
        ...prev,
        [cacheKey]: {
          ...delivery,
          status: 'SKIPPED'
        }
      }));
      setSkipSuccess(true);
      setTimeout(() => {
        setSkipSuccess(false);
      }, 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to skip delivery';
      setSkipError(message);
    } finally {
      setIsSkipping(false);
    }
  };

  const statusStyles: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800',
    DISPATCHED: 'bg-blue-100 text-blue-800',
    DELIVERED: 'bg-green-100 text-green-800',
    SKIPPED: 'bg-gray-100 text-gray-800',
    CANCELLED: 'bg-red-100 text-red-800',
  };

  const canSkip = delivery ? isBeforeCutoff(delivery.cutoff_time) : false;
  const nonSkippableStatuses = ['SKIPPED', 'CANCELLED', 'DELIVERED', 'DISPATCHED'];

  
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Delivery Schedule</h1>
      
      {!activeSubscriptionId ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center text-gray-500">
          No Active Subscription found.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Calendar Grid */}
          <div className="md:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Select Date</h2>
            <div className="grid grid-cols-7 gap-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="text-center text-xs font-semibold text-gray-500 py-2">
                  {day}
                </div>
              ))}
              
              {/* Dynamic padding for the first day of the month */}
              {Array.from({ length: firstDayOffset }).map((_, i) => (
                <div key={`empty-${i}`}></div>
              ))}
              
              {dates.map((date) => {
                const dayNum = new Date(date).getDate();
                const isSelected = selectedDate === date;
                return (
                  <button
                    key={date}
                    onClick={() => {
                      setSelectedDate(date);
                      setSelectedSlot(null); // Reset slot on new date selection
                    }}
                    className={`h-10 w-full rounded-md text-sm font-medium transition-colors ${
                      isSelected 
                        ? 'bg-amber-600 text-white shadow-sm' 
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {dayNum}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Side Panel: Slots & Details */}
          <div className="md:col-span-1 space-y-6">
            
            {/* Slot Selection */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Select Meal</h2>
              {selectedDate ? (
                <div className="space-y-3">
                  <button
                    onClick={() => setSelectedSlot('LUNCH')}
                    className={`w-full py-3 px-4 rounded-lg border text-sm font-medium transition-colors ${
                      selectedSlot === 'LUNCH'
                        ? 'border-amber-600 bg-amber-50 text-amber-800'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Lunch
                  </button>
                  <button
                    onClick={() => setSelectedSlot('DINNER')}
                    className={`w-full py-3 px-4 rounded-lg border text-sm font-medium transition-colors ${
                      selectedSlot === 'DINNER'
                        ? 'border-amber-600 bg-amber-50 text-amber-800'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Dinner
                  </button>
                </div>
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">
                  Please select a date first.
                </p>
              )}
            </div>

            {/* Delivery Details Placeholder */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 min-h-[200px] flex flex-col items-center justify-center text-center">
              {selectedDate && selectedSlot ? (
                <div className="w-full">
                  {isFetchingDelivery ? (
                    <div className="text-gray-500 text-center py-4 animate-pulse">
                      <p className="text-sm">Fetching delivery details...</p>
                    </div>
                  ) : fetchError ? (
                    <div className="text-center py-4">
                      <p className="text-sm text-red-500 mb-4">{fetchError}</p>
                      <button 
                        onClick={() => {
                          setFetchError(null);
                          setDeliveryCache(prev => {
                            const newCache = {...prev};
                            delete newCache[`${selectedDate}_${selectedSlot}`];
                            return newCache;
                          });
                          setRetryTrigger(prev => prev + 1);
                        }}
                        className="px-4 py-2 border border-red-200 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 transition-colors"
                      >
                        Retry Fetch
                      </button>
                    </div>
                  ) : delivery ? (
                    <div className="text-left space-y-4 w-full">
                      <div className="flex justify-between items-center border-b pb-4">
                        <h3 className="text-sm font-medium text-gray-500">Status</h3>
                        <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${statusStyles[delivery.status] || 'bg-gray-100 text-gray-800'}`}>
                          {delivery.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs text-gray-500">Slot</p>
                          <p className="text-sm font-medium text-gray-900 mt-1">{delivery.slot}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">Type</p>
                          <p className="text-sm font-medium text-gray-900 mt-1">
                            {delivery.is_buffer_meal ? 'Buffer Meal' : 'Regular Meal'}
                          </p>
                        </div>
                      </div>
                      
                      <div className="pt-4 mt-4 border-t border-gray-100">
                        {skipError && <p className="text-sm text-red-500 mb-3">{skipError}</p>}
                        {skipSuccess && <p className="text-sm text-green-600 mb-3 font-medium">Delivery skipped successfully</p>}
                        <button
                          onClick={handleSkipDelivery}
                          disabled={isSkipping || !delivery || nonSkippableStatuses.includes(delivery.status) || !canSkip}
                          className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {isSkipping ? 'Skipping...' : delivery.status === 'SKIPPED' ? 'Skipped' : !canSkip ? 'Past Cutoff Time' : 'Skip Delivery'}
                        </button>
                      </div>
                    </div>
                  ) : !isFetchingDelivery && !fetchError && !delivery ? (
                    <div className="text-gray-500 text-center py-4">
                      <p className="text-sm">No delivery scheduled for this slot.</p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-gray-400">
                  Details will appear here
                </p>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

// DONE