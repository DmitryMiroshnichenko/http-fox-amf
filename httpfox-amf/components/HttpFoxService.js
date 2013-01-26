/*
	HttpFox - An HTTP analyzer addon for Firefox
	Copyright (C) 2008 Martin Theimer
	
	This program is free software; you can redistribute it and/or modify
	it under the terms of the GNU General Public License as published by
	the Free Software Foundation; either version 2 of the License, or
	(at your option) any later version.
	
	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU General Public License for more details.
	
	You should have received a copy of the GNU General Public License
	along with this program; if not, write to the Free Software
	Foundation, Inc., 675 Mass Ave, Cambridge, MA 02139, USA.
*/

/***********************************************************
constants
***********************************************************/
// reference to the interface defined in nsIHelloWorld.idl
//const nsIHelloWorld = Components.interfaces.nsIHelloWorld;

// reference to the required base interface that all components must support
const nsISupports = Components.interfaces.nsISupports;

// UUID uniquely identifying our component
const CLASS_ID = Components.ID("{307fd88d-5c81-4487-bb0d-42e228a68767}");

// description
const CLASS_NAME = "HttpFox Service";

// textual unique identifier
const CONTRACT_ID = "@decoded.net/httpfox;1";

// import utils
try {
	Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
}
catch(e) {}

/***********************************************************
class definition
***********************************************************/
//class constructor
function HttpFoxService() 
{
	this.wrappedJSObject = this;
	this.init();
};

// class definition
HttpFoxService.prototype = 
{
	classID: CLASS_ID,
	classDescription: CLASS_NAME,
	contractID: CONTRACT_ID,

	// Controller/Interface list
	Controllers: null,
	
	// Request Observer
	Observer: null,

	// All requests (holds HttpFoxRequest objects)
	Requests: null,

	// All pending requests (isPending == true)
	PendingRequests: null,

	// session start timestamp
	StartTime: null,
	
	// is observer currently running
	IsWatching: false,
	
	// user preferences
	Preferences: null,
	
	// detach window reference
	HttpFoxWindow: null,
	
	init: function() 
	{
		this.Controllers = new Array();
		
		this.Requests = new Array();
		this.PendingRequests = new Array();
		
		this.StartTime = new Date();
		
		this.Observer = new HttpFoxObserver(this);
		
		this.Preferences = new HttpFoxPreferences();
		
		if (this.Preferences.StartAtBrowserStart)
		{
			this.startWatching();
		}
	},
	
	addController: function(HttpFoxControllerReference)
	{
		this.Controllers.push(HttpFoxControllerReference);
		HttpFoxControllerReference.ControllerIndex = this.Controllers.length;
	},
	
	removeController: function(HttpFoxControllerReference)
	{
		for (var i = 0; i < this.Controllers.length; i++)
		{
			if (this.Controllers[i] === HttpFoxControllerReference)
			{
				this.Controllers.splice(i, 1);
				break;
			}
		}
	},
	
	startWatching: function() 
	{
		this.Observer.start();
		this.IsWatching = true;
	},
	
	stopWatching: function() 
	{
		this.Observer.stop();
		this.IsWatching = false;
	},
	
	clearRequests: function()
	{
		this.Requests = new Array();
		this.PendingRequests = new Array();
		
		this.StartTime = new Date();
	},
	
	windowIsClosed: function()
	{
		this.callControllerMethod("windowIsClosed");
	},
	
	callControllerMethod: function(methodName, parameterArray)
	{
		for (var c in this.Controllers)
		{
			this.Controllers[c][methodName].call(this.Controllers[c], parameterArray);
		}
	},
	
	isNewRequest: function(request)
	{
		return (this.getPendingRequestForRequestEvent(request) == -1) ? true : false;
	},
	
	getPendingRequestForRequestEvent: function(request)
	{
		// check for matching request
		for (var i = 0; i < this.Requests.length; i++) 
		{
			if (request.HttpChannel === this.Requests[i].HttpChannel) 
			{
				return i;
			}
		}
		
		// no match found
		return -1;
	},
	
	// thanks to tamper data:
	forceCaching: function(request) {
		// we only care if we were a POST, GET's cache no matter what
		if (request.requestMethod == "POST") 
		{
			if (request.loadFlags & Components.interfaces.nsIRequest.INHIBIT_CACHING) 
			{
				if (this.Preferences.ForceCaching) 
				{
					request.loadFlags = request.loadFlags & ~Components.interfaces.nsIRequest.INHIBIT_CACHING;
				}
			}
		}
	},
	
	addNewRequest: function(requestEvent)
	{
		// a new request
		var request = new HttpFoxRequest(requestEvent.HttpFox, requestEvent.HttpChannel, requestEvent.Context, requestEvent);
		this.Requests.push(request);
		this.PendingRequests.push(request);
		
		// check filter
		this.callControllerMethod("filterRequest", {"p1" : request});
		
		// start checking
		if (this.IntervalChecker == null)
		{
			this.IntervalChecker = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
			var callback = 
			{
				notify: function(timer) 
				{
					this.parent.checkPendingRequests();
					return;
				}
			};
			callback.parent = this;
			this.IntervalChecker.initWithCallback(callback, 10, Components.interfaces.nsITimer.TYPE_REPEATING_SLACK);
		}
	},
	
	updateRequest: function(index, updatedRequest)
	{
		this.Requests[index].updateFromRequestEvent(updatedRequest);

		this.callControllerMethod("redrawRequestTree", {"p1": index});
	},
	
	//M
	checkPendingRequests: function()
	{
		try 
		{
			var before = this.PendingRequests.length;
			for (var i = 0; i < this.PendingRequests.length; i++)
			{
				if (!this.PendingRequests[i].HttpChannel.isPending() && !this.PendingRequests[i].IsFinal)
				{
					// complete request. release channel reference.
					var requestIndex = this.getPendingRequestForRequestEvent(this.PendingRequests[i]);
					this.PendingRequests[i].complete();
					this.callControllerMethod("redrawRequestTree", {"p1": requestIndex});
					this.PendingRequests.splice(i, 1);
					i--;
				}
			}
			
			if (this.PendingRequests.length == 0) 
			{
				if (this.IntervalChecker != null)
				{
					this.IntervalChecker.cancel();
					this.IntervalChecker = null;
				}
			}
			
			//this.callControllerMethod("redrawRequestTree")
		}
		catch(e)
		{}
	},
	
	//C
	handleRequestEvent: function(requestEvent)
	{
		// checking pending requests
		this.checkPendingRequests();
		
		// check if this is a http request:
		try 
		{
			requestEvent.HttpChannel.QueryInterface(Components.interfaces.nsIHttpChannel);
		}
		catch (ex) 
		{
			return;
		}
		
		// check if this is just our response content loader
		if (!this.Preferences.ShowHttpFoxHelperRequests && requestEvent.HttpChannel.owner) 
		{
			try 
			{
				if (requestEvent.HttpChannel.owner.QueryInterface(Components.interfaces.nsISupportsString).data == "HttpFoxResponseLoaderFlagger") 
				{
					// don't log.
					return;
				}
			}
			catch(ex) 
			{}
		}
		
		switch(requestEvent.EventSource) 
		{
			case this.HttpFoxEventSourceType.ON_MODIFY_REQUEST:
			case this.HttpFoxEventSourceType.ON_EXAMINE_RESPONSE:
			case this.HttpFoxEventSourceType.ON_EXAMINE_MERGED_RESPONSE:
			case this.HttpFoxEventSourceType.EVENTSINK_ON_PROGRESS:
			case this.HttpFoxEventSourceType.EVENTSINK_ON_STATUS:
			case this.HttpFoxEventSourceType.WEBPROGRESS_ON_STATUS_CHANGED:
			case this.HttpFoxEventSourceType.WEBPROGRESS_ON_STATE_CHANGED:
			case this.HttpFoxEventSourceType.WEBPROGRESS_ON_SECURITY_CHANGED:
			case this.HttpFoxEventSourceType.WEBPROGRESS_ON_PROGRESS_CHANGED:
			case this.HttpFoxEventSourceType.WEBPROGRESS_ON_LOCATION_CHANGED:
				//find matching request 
				var index = this.getPendingRequestForRequestEvent(requestEvent);
				if (index == -1)
				{
					if (requestEvent.EventSource != this.HttpFoxEventSourceType.ON_MODIFY_REQUEST) 
					{
						//only ON_MODIFY_REQUEST can be a new one. discard other types
						return;
					}
					// new request. add.
					this.addNewRequest(requestEvent);
					
					// not found. not good. TODO: handling
				}
				else 
				{
					this.updateRequest(index, requestEvent);
				}
				break;
		}
	},
	
	getStatusTextFromCode: function(HttpFoxStatusCode, status)
	{
		var statusText = "";
		switch(HttpFoxStatusCode)
		{
			case this.HttpFoxStatusCodeType.SOCKETTRANSPORT:
				switch(status)
				{
					case Components.interfaces.nsISocketTransport.STATUS_RESOLVING:
						statusText = "STATUS_RESOLVING";
						break;
						
					case Components.interfaces.nsISocketTransport.STATUS_CONNECTING_TO:
						statusText = "STATUS_CONNECTING_TO";
						break;
						
					case Components.interfaces.nsISocketTransport.STATUS_CONNECTED_TO:
						statusText = "STATUS_CONNECTED_TO";
						break;
						
					case Components.interfaces.nsISocketTransport.STATUS_SENDING_TO:
						statusText = "STATUS_SENDING_TO";
						break;
						
					case Components.interfaces.nsISocketTransport.STATUS_WAITING_FOR:
						statusText = "STATUS_WAITING_FOR";
						break;
						
					case Components.interfaces.nsISocketTransport.STATUS_RECEIVING_FROM:
						statusText = "STATUS_RECEIVING_FROM";
						break;
						
					case Components.interfaces.nsITransport.STATUS_READING:
						statusText = "STATUS_READING";
						break;
						
					case Components.interfaces.nsITransport.STATUS_WRITING:
						statusText = "STATUS_WRITING";
						break;
						
					default:
						statusText = "UNKOWN CODE (" + status + ")";
						break;
				}
				break;
				
			case this.HttpFoxStatusCodeType.WEBPROGRESS_TRANSITION:
				if (status & Components.interfaces.nsIWebProgressListener.STATE_START)
				{
					statusText = "STATE_START";
				}
				if (status & Components.interfaces.nsIWebProgressListener.STATE_REDIRECTING)
				{
					statusText = "STATE_REDIRECTING";
				}
				if (status & Components.interfaces.nsIWebProgressListener.STATE_TRANSFERRING)
				{
					statusText = "STATE_TRANSFERRING";
				}
				if (status & Components.interfaces.nsIWebProgressListener.STATE_NEGOTIATING)
				{
					statusText = "STATE_NEGOTIATING";
				}
				if (status & Components.interfaces.nsIWebProgressListener.STATE_STOP)
				{
					statusText = "STATE_STOP";
				}
				break;
				
			case this.HttpFoxStatusCodeType.WEBPROGRESS_TYPE:
				if (status & Components.interfaces.nsIWebProgressListener.STATE_IS_REQUEST)
				{
					statusText += "STATE_IS_REQUEST ";
				}
				if (status & Components.interfaces.nsIWebProgressListener.STATE_IS_DOCUMENT) 
				{
					statusText += "STATE_IS_DOCUMENT ";
				}
				if (status & Components.interfaces.nsIWebProgressListener.STATE_IS_NETWORK) 
				{
					statusText += "STATE_IS_NETWORK ";
				}
				if (status & Components.interfaces.nsIWebProgressListener.STATE_IS_WINDOW) 
				{
					statusText += "STATE_IS_WINDOW ";
				}
				statusText = statusText.substr(0, statusText.length - 1);
				break;
			
			case this.HttpFoxStatusCodeType.WEBPROGRESS_MODIFIER:	
				if (status & Components.interfaces.nsIWebProgressListener.STATE_RESTORING) 
				{
					statusText = "STATE_IS_RESTORING";
				}
				break;
				
			case this.HttpFoxStatusCodeType.WEBPROGRESS_SECURITY:
				if (status & Components.interfaces.nsIWebProgressListener.STATE_IS_INSECURE) 
				{
					statusText = "STATE_IS_INSECURE";
				}
				if (status & Components.interfaces.nsIWebProgressListener.STATE_IS_BROKEN) 
				{
					statusText = "STATE_IS_BROKEN";
				}
				if (status & Components.interfaces.nsIWebProgressListener.STATE_IS_SECURE) 
				{
					statusText = "STATE_IS_SECURE";
				}
				break;
				
			case this.HttpFoxStatusCodeType.WEBPROGRESS_SECURITY_STRENGTH:
				if (status & Components.interfaces.nsIWebProgressListener.STATE_SECURE_HIGH) 
				{
					statusText = "STATE_SECURE_HIGH";
				}
				if (status & Components.interfaces.nsIWebProgressListener.STATE_SECURE_MED) 
				{
					statusText = "STATE_SECURE_MED";
				}
				if (status & Components.interfaces.nsIWebProgressListener.STATE_SECURE_LOW) 
				{
					statusText = "STATE_SECURE_LOW";
				}
				break;
				
			case this.HttpFoxStatusCodeType.LOADFLAGS_CHANNEL:
				if (status & Components.interfaces.nsIChannel.LOAD_DOCUMENT_URI) 
				{
					statusText += "LOAD_DOCUMENT_URI ";
				}
				if (status & Components.interfaces.nsIChannel.LOAD_RETARGETED_DOCUMENT_URI) 
				{
					statusText += "LOAD_RETARGETED_DOCUMENT_URI ";
				}
				if (status & Components.interfaces.nsIChannel.LOAD_INITIAL_DOCUMENT_URI) 
				{
					statusText += "LOAD_INITIAL_DOCUMENT_URI ";
				}
				if (status & Components.interfaces.nsIChannel.LOAD_REPLACE) 
				{
					statusText += "LOAD_REPLACE ";
				}
				if (status & Components.interfaces.nsIChannel.LOAD_TARGETED) 
				{
					statusText += "LOAD_TARGETED ";
				}
				statusText = statusText.substr(0, statusText.length - 1);
				break;
				
			case this.HttpFoxStatusCodeType.LOADFLAGS_REQUEST:
				if (status & Components.interfaces.nsIRequest.LOAD_BYPASS_CACHE) 
				{
					statusText += "LOAD_BYPASS_CACHE ";
				}
				if (status & Components.interfaces.nsIRequest.LOAD_BACKGROUND) 
				{
					statusText += "LOAD_BACKGROUND ";
				}
				if (status & Components.interfaces.nsIRequest.INHIBIT_CACHING) 
				{
					statusText += "INHIBIT_CACHING ";
				}
				if (status & Components.interfaces.nsIRequest.INHIBIT_PERSISTENT_CACHING) 
				{
					statusText += "INHIBIT_PERSISTENT_CACHING ";
				}
				if (status & Components.interfaces.nsIRequest.LOAD_FROM_CACHE) 
				{
					statusText += "LOAD_FROM_CACHE ";
				}
				if (status & Components.interfaces.nsIRequest.VALIDATE_ALWAYS) 
				{
					statusText += "VALIDATE_ALWAYS ";
				}
				if (status & Components.interfaces.nsIRequest.VALIDATE_NEVER) 
				{
					statusText += "VALIDATE_NEVER ";
				}
				if (status & Components.interfaces.nsIRequest.VALIDATE_ONCE_PER_SESSION) 
				{
					statusText += "VALIDATE_ONCE_PER_SESSION ";
				}
				statusText = statusText.substr(0, statusText.length - 1);
				break;
				
			case this.HttpFoxStatusCodeType.LOADFLAGS_CACHING:
				if (status & Components.interfaces.nsICachingChannel.LOAD_BYPASS_LOCAL_CACHE) 
				{
					statusText += "LOAD_BYPASS_LOCAL_CACHE ";
				}
				if (status & Components.interfaces.nsICachingChannel.LOAD_ONLY_FROM_CACHE) 
				{
					statusText += "LOAD_ONLY_FROM_CACHE ";
				}
				if (status & Components.interfaces.nsICachingChannel.LOAD_ONLY_IF_MODIFIED) 
				{
					statusText += "LOAD_ONLY_IF_MODIFIED ";
				}
				if ((Components.interfaces.nsICachingChannel.LOAD_BYPASS_LOCAL_CACHE_IF_BUSY) && 
	          		(status & Components.interfaces.nsICachingChannel.LOAD_BYPASS_LOCAL_CACHE_IF_BUSY))
				{
					statusText += "LOAD_BYPASS_LOCAL_CACHE_IF_BUSY ";
				}
				statusText = statusText.substr(0, statusText.length - 1);
				break;
				
			default:
				statusText = "UNKOWN STATUSCODETYPE";
				break;
		}
		
		return statusText;
	},

	getEventSourceName: function(EventSource)
	{
		switch(EventSource)
		{
			case this.HttpFoxEventSourceType.ON_MODIFY_REQUEST:
				return "ON_MODIFY_REQUEST";
				break;
				
			case this.HttpFoxEventSourceType.ON_EXAMINE_RESPONSE:
				return "ON_EXAMINE_RESPONSE";
				break;
				
			case this.HttpFoxEventSourceType.ON_EXAMINE_MERGED_RESPONSE:
				return "ON_EXAMINE_MERGED_RESPONSE";
				break;
				
			case this.HttpFoxEventSourceType.EVENTSINK_ON_PROGRESS:
				return "EVENTSINK_ON_PROGRESS";
				break;
				
			case this.HttpFoxEventSourceType.EVENTSINK_ON_STATUS:
				return "EVENTSINK_ON_STATUS";
				break;
				
			case this.HttpFoxEventSourceType.WEBPROGRESS_ON_STATUS_CHANGED:
				return "WEBPROGRESS_ON_STATUS_CHANGED";
				break;
				
			case this.HttpFoxEventSourceType.WEBPROGRESS_ON_STATE_CHANGED:
				return "WEBPROGRESS_ON_STATE_CHANGED";
				break;
				
			case this.HttpFoxEventSourceType.WEBPROGRESS_ON_SECURITY_CHANGED:
				return "WEBPROGRESS_ON_SECURITY_CHANGED";
				break;
				
			case this.HttpFoxEventSourceType.WEBPROGRESS_ON_PROGRESS_CHANGED:
				return "WEBPROGRESS_ON_PROGRESS_CHANGED";
				break;
				
			case this.HttpFoxEventSourceType.WEBPROGRESS_ON_LOCATION_CHANGED:
				return "WEBPROGRESS_ON_LOCATION_CHANGED";
				break;
				
			case this.HttpFoxEventSourceType.SCANNED_COMPLETE:
				return "SCANNED_COMPLETE (manual)";
				break;
				
			default:
				return "UNKOWN EVENTSOURCE TYPE";
				break;
		}
		
		return null;
	},

	QueryInterface: function(aIID)
	{
		if (!aIID.equals(nsISupports))
		{
			throw Components.results.NS_ERROR_NO_INTERFACE;
		}
		return this;
	}
};

HttpFoxService.prototype.HttpFoxEventSourceType = 
{
	ON_MODIFY_REQUEST: 0,
	ON_EXAMINE_RESPONSE: 1,
	ON_EXAMINE_MERGED_RESPONSE: 2,
	EVENTSINK_ON_PROGRESS: 3,
	EVENTSINK_ON_STATUS: 4,
	WEBPROGRESS_ON_STATUS_CHANGED: 5,
	WEBPROGRESS_ON_STATE_CHANGED: 6,
	WEBPROGRESS_ON_SECURITY_CHANGED: 7,
	WEBPROGRESS_ON_PROGRESS_CHANGED: 8,
	WEBPROGRESS_ON_LOCATION_CHANGED: 9,
	SCANNED_COMPLETE: 10
};

HttpFoxService.prototype.HttpFoxStatusCodeType =
{
	SOCKETTRANSPORT: 0,
	WEBPROGRESS_TRANSITION: 1,
	WEBPROGRESS_TYPE: 2,
	WEBPROGRESS_SECURITY: 3,
	WEBPROGRESS_SECURITY_STRENGTH: 4,
	WEBPROGRESS_MODIFIER: 5,
	LOADFLAGS_REQUEST: 6,
	LOADFLAGS_CHANNEL: 7,
	LOADFLAGS_CACHING: 8
};



function HttpFoxPreferences() 
{
	this.init();
};

HttpFoxPreferences.prototype = 
{
	prefs: null,
	
	// Options
	_StartAtBrowserStart: null,
	
	_AlwaysOpenDetached: null,
	
	_ShowHttpFoxHelperRequests: null,
	
	_ColorRequests: null,
	
	_ShowDebugTab: null,
	
	_ForceCaching: null,
		
	init: function() 
	{
		// Register to receive notifications of preference changes
		this.prefs = Components.classes["@mozilla.org/preferences-service;1"]
			.getService(Components.interfaces.nsIPrefService)
			.getBranch("extensions.httpfox.");
		this.prefs.QueryInterface(Components.interfaces.nsIPrefBranch2);
		this.prefs.addObserver("", this, false);
	
		// init values
		this._StartAtBrowserStart = this.prefs.getBoolPref("StartAtBrowserStart");
		this._AlwaysOpenDetached = this.prefs.getBoolPref("AlwaysOpenDetached");
		this._ShowHttpFoxHelperRequests = this.prefs.getBoolPref("ShowHttpFoxHelperRequests");
		this._ColorRequests = this.prefs.getBoolPref("ColorRequests");
		this._ShowDebugTab = this.prefs.getBoolPref("ShowDebugTab");
		this._ForceCaching = this.prefs.getBoolPref("ForceCaching");
	},
	
	shutdown: function()
	{
		this.prefs.removeObserver("", this);
	},
	
	observe: function(subject, topic, data)
	{
		if (topic != "nsPref:changed")
		{
			return;
		}

		switch(data)
		{
			case "StartAtBrowserStart":
				this._StartAtBrowserStart = this.prefs.getBoolPref("StartAtBrowserStart");
				break;
				
			case "AlwaysOpenDetached":
				this._AlwaysOpenDetached = this.prefs.getBoolPref("AlwaysOpenDetached");
				break;
				
			case "ShowHttpFoxHelperRequests":
				this._ShowHttpFoxHelperRequests = this.prefs.getBoolPref("ShowHttpFoxHelperRequests");
				break;
				
			case "ColorRequests":
				this._ColorRequests = this.prefs.getBoolPref("ColorRequests");
				break;
				
			case "ShowDebugTab":
				this._ShowDebugTab = this.prefs.getBoolPref("ShowDebugTab");
				break;
				
			case "ForceCaching":
				this._ForceCaching = this.prefs.getBoolPref("ForceCaching");
				break;
		}
	},
	
	get StartAtBrowserStart() 
	{ 
		return this._StartAtBrowserStart;
	},
	set StartAtBrowserStart(value) 
	{
		this._StartAtBrowserStart = value;
		this.prefs.setCharPref("StartAtBrowserStart", value);
	},
	
	get AlwaysOpenDetached() 
	{ 
		return this._AlwaysOpenDetached;
	},
	set AlwaysOpenDetached(value) 
	{
		this._AlwaysOpenDetached = value;
		this.prefs.setIntPref("AlwaysOpenDetached", value);
	},
	
	get ShowHttpFoxHelperRequests() 
	{ 
		return this._ShowHttpFoxHelperRequests;
	},
	set ShowHttpFoxHelperRequests(value) 
	{
		this._ShowHttpFoxHelperRequests = value;
		this.prefs.setBoolPref("ShowHttpFoxHelperRequests", value);
	},
	
	get ColorRequests() 
	{ 
		return this._ColorRequests;
	},
	set ColorRequests(value) 
	{
		this._ColorRequests = value;
		this.prefs.setBoolPref("ColorRequests", value);
	},
	
	get ShowDebugTab() 
	{ 
		return this._ShowDebugTab;
	},
	set ShowDebugTab(value) 
	{
		this._ShowDebugTab = value;
		this.prefs.setBoolPref("ShowDebugTab", value);
	},
	
	get ForceCaching() 
	{ 
		return this._ForceCaching;
	},
	set ForceCaching(value) 
	{
		this._ForceCaching = value;
		this.prefs.setBoolPref("ForceCaching", value);
	}
};

// ************************************************************************************************

// HttpFoxRequest
function HttpFoxRequest(HttpFoxServiceReference, HttpChannelReference, HttpFoxContext, HttpFoxRequestEventReference)
{
	try 
	{
		this.HttpChannel = HttpChannelReference.QueryInterface(Components.interfaces.nsIHttpChannel);
	}
	catch(ex) 
	{
		// discard that non-httpchannel thing
		return
	}
	this.HttpFox = HttpFoxServiceReference;
	this.Context = HttpFoxContext;
	this.AmfParserInstance = new AmfParser();
	
	this.init(HttpFoxRequestEventReference);
}
HttpFoxRequest.prototype = 
{
	HttpFox: null,
	HttpChannel: null,
	Context: null,
	RequestLog: null,
	EventSource: null,
	EventSourceData: null,
	MasterIndex: null,
	HttpFoxRequestEventSink: null,
	
	// custom request properties
	StartTimestamp: null,
	ResponseStartTimestamp: null,
	EndTimestamp: null,
	Content: null,
	ContentStatus: null,
	BytesLoaded: 0,
	BytesLoadedTotal: 0,
	BytesSent: 0,
	BytesSentTotal: 0,
	ResponseHeadersSize: 0,
	RequestHeadersSize: 0,
	
	// request states
	IsFinished: false,
	IsFinal: false, // last scan and cleanup was done
	IsAborted: false,
	IsLoadingBody: false,
	IsSending: false,
	HasReceivedResponseHeaders: false,
	IsRedirect: false,
	HasErrorCode: false,
	IsError: false,
	IsFromCache: false,
	HasCacheInfo: false,
	//IsContentAvailable: false,
	HasPostData: false, 
	HasQueryStringData: false,
	HasCookieData: false,
	
	// request/response data
	RequestHeaders: null,
	ResponseHeaders: null,
	PostDataHeaders: null,
	PostData: null,
	PostDataParameters: null,
	PostDataMIMEParts: null,
	PostDataMIMEBoundary: null,
	IsPostDataMIME: null,
	PostDataContentLength: null,
	IsPostDataTooBig: false,
	QueryString: null,
	QueryStringParameters: null,
	CookiesSent: null,
	CookiesReceived: null,
	IsBackground: false,
	
	// httpchannel-, request properties
	Status: null,
	Url: null,
	URIPath: null,
	URIScheme: null,
	RequestProtocolVersion: null,
	RequestMethod: null,
	ResponseProtocolVersion: null,
	ResponseStatus: null,
	ResponseStatusText: null,
	ContentType: null,
	ContentCharset: null,
	ContentLength: null,
	LoadFlags: null,
	Name: null,
	RequestSucceeded: null,
	IsNoStoreResponse: null,
	IsNoCacheResponse: null,
	IsFromCache: null,
	CacheToken: null,
	CacheToken_key: null,
	CacheKey: null,
	CacheAsFile: null,
	CacheFile: null,
	Priority: null,
	EntityId: null,
	
	// amf parsing
	AmfParserInstance: null,
	
	init: function(requestEvent)
	{
		// set current as starttime of request
		this.setStartTimestampNow();
		
		// a new request log
		this.RequestLog = new Array();

		// store event sink
		this.HttpFoxRequestEventSink = requestEvent.HttpFoxRequestEventSink;
		
		// update/init from first requestevent
		this.updateFromRequestEvent(requestEvent)
	},
	
	checkRequestState: function()
	{
		// aborted:		
		if (this.EventSource == this.HttpFox.HttpFoxEventSourceType.WEBPROGRESS_ON_STATE_CHANGED
			//&& getStatusTextFromCode(HttpFoxStatusCodeType.WEBPROGRESS_TRANSITION, this.EventSourceData["flags"]) == "STATE_STOP"
			&& this.EventSourceData["flags"] & Components.interfaces.nsIWebProgressListener.STATE_STOP
			&& this.EventSourceData["status"] == utils.HttpFoxNsResultErrors.NS_BINDING_ABORTED)
		{
			// aborted
			this.setAborted();
			return;
		}
		
		if (this.EventSource == this.HttpFox.HttpFoxEventSourceType.WEBPROGRESS_ON_STATE_CHANGED
			&& this.EventSourceData["flags"] & Components.interfaces.nsIWebProgressListener.STATE_STOP) 
		{
			// all finished
			this.setFinished();
			return;
		}
		
		if (this.IsBackground && this.EventSource == this.HttpFox.HttpFoxEventSourceType.ON_EXAMINE_RESPONSE)
		{
			this.setFinished();
			return;
		}
		
		if (this.EventSource == this.HttpFox.HttpFoxEventSourceType.ON_EXAMINE_MERGED_RESPONSE)
		{
			// got 304 and got content from cache
			this.setFinished();
			this.HasCacheInfo = true;
			this.BytesLoaded = this.BytesLoadedTotal = this.HttpChannel.contentLength;
			return;
		}

		if (this.EventSource == this.HttpFox.HttpFoxEventSourceType.ON_EXAMINE_RESPONSE
			&& (this.ResponseStatus != 200))
		{
			this.setFinished();
			return;
		}
		
		if (this.BytesLoadedTotal > 0 && this.BytesLoaded >= this.BytesLoadedTotal)
		{
			this.setFinished();
			return;
		}
		
		if (this.BytesLoadedTotal == -1 && this.ContentLength != null)
		{
			this.setFinished();
			return;
		}
		
		if (this.EventSource == this.HttpFox.HttpFoxEventSourceType.WEBPROGRESS_ON_STATE_CHANGED
			&& (this.EventSourceData["flags"] & Components.interfaces.nsIWebProgressListener.STATE_REDIRECTING)) 
		{
			this.ResponseStatus = this.HttpChannel.responseStatus;
			this.setFinished();
			// TODO: only if there wasn't a 302 already. so move to "are we finished code"
			// TODO: set 301, read from an cache entry. directly... to get 301 target url
			return;
		}
		
		if (this.EventSource == this.HttpFox.HttpFoxEventSourceType.ON_EXAMINE_RESPONSE
			&& this.ContentLength != null && (this.ContentLength == 0 || this.ContentLength == -1))
		{
			// 0 = no content. finished.
			this.setFinished();
			return;
		}
	},
	
	updateFromRequestEvent: function(requestEvent)
	{
		try
		{
		// check if just a status update
		if (requestEvent.EventSource == this.HttpFox.HttpFoxEventSourceType.EVENTSINK_ON_STATUS
			|| requestEvent.EventSource == this.HttpFox.HttpFoxEventSourceType.WEBPROGRESS_ON_STATUS_CHANGED)
		{
			if ((this.IsLoadingBody || this.IsSending) 
				&& this.RequestLog[this.RequestLog.length - 1].EventSource == this.HttpFox.HttpFoxEventSourceType.EVENTSINK_ON_STATUS
				//&& (getStatusTextFromCode(HttpFoxStatusCodeType.SOCKETTRANSPORT, requestEvent.EventSourceData["status"]) == "STATUS_RECEIVING_FROM"
				&& (requestEvent.EventSourceData["status"] == Components.interfaces.nsISocketTransport.STATUS_RECEIVING_FROM
					|| requestEvent.EventSourceData["status"] == Components.interfaces.nsISocketTransport.STATUS_SENDING_TO))
					//|| getStatusTextFromCode(HttpFoxStatusCodeType.SOCKETTRANSPORT, requestEvent.EventSourceData["status"]) == "STATUS_SENDING_TO"))
			{
				// no need for multiple loading status change logs. just return
				return;
			}
		}
		
		// check if just a progress update
		if (requestEvent.EventSource == this.HttpFox.HttpFoxEventSourceType.EVENTSINK_ON_PROGRESS
			|| requestEvent.EventSource == this.HttpFox.HttpFoxEventSourceType.WEBPROGRESS_ON_PROGRESS_CHANGED)
		{
			if (requestEvent.EventSource == this.HttpFox.HttpFoxEventSourceType.EVENTSINK_ON_PROGRESS)
			{
				var progress = requestEvent.EventSourceData["progress"];
				var progressMax = requestEvent.EventSourceData["progressMax"];
			}
			else if (requestEvent.EventSource == this.HttpFox.HttpFoxEventSourceType.WEBPROGRESS_ON_PROGRESS_CHANGED)
			{
				var progress = requestEvent.EventSourceData["curSelfProgress"];
				var progressMax = requestEvent.EventSourceData["maxSelfProgress"];
			}
		
			if (this.IsLoadingBody || this.IsSending)
			{
				if (progress < progressMax)
				{
					if (this.IsSending)
					{
						// just update progress size and return
						this.BytesSent = progress;
						this.BytesSentTotal = progressMax;
					}
					else
					{
						// just update progress size and return
						this.BytesLoaded = progress;
						this.BytesLoadedTotal = progressMax;	
					}
				
					return;
				}
			}
			else if (!this.IsFinished)
			{
				// first load progress. store it
				this.IsLoadingBody = true;
			}
		}
		
		// update the properties
		this.adjustDataFromRequestEvent(requestEvent);
		
		// log the requestevent
		this.logEvent(new HttpFoxRequestLogData(requestEvent));

		// update request states
		this.checkRequestState();
		}
		catch(e)
		{
			dump("\ne: " + e);
		}
	},
	
	adjustDataFromRequestEvent: function(requestEvent)
	{
		this.EventSource = requestEvent.EventSource;
		this.EventSourceData = requestEvent.EventSourceData;
		
		if (requestEvent.EventSource == this.HttpFox.HttpFoxEventSourceType.ON_MODIFY_REQUEST)
		{
			// start sending
			this.IsSending = true;
		}
		
		if (requestEvent.EventSource == this.HttpFox.HttpFoxEventSourceType.ON_EXAMINE_RESPONSE)
		{
			// start receiving
			this.IsSending = false;
			this.HasReceivedResponseHeaders = true;
			this.ResponseStartTimestamp = (new Date()).getTime();
		}
		
		if (this.Url == null)
		{
			this.Url = requestEvent.Url;
		}
		
		if (this.URIPath == null)
		{
			this.URIPath = requestEvent.URIPath;
		}
		
		if (this.URIScheme == null)
		{
			this.URIScheme = requestEvent.URIScheme;
		}

		if (this.RequestProtocolVersion == null)
		{
			this.RequestProtocolVersion = requestEvent.RequestProtocolVersion;
		}
		
		if (this.RequestMethod == null)
		{
			this.RequestMethod = requestEvent.RequestMethod;
		}
		
		if (this.ResponseProtocolVersion == null)
		{
			this.ResponseProtocolVersion = requestEvent.ResponseProtocolVersion;
		}
		
		if (requestEvent.ResponseStatus != null 
			&& this.ResponseStatus != requestEvent.ResponseStatus
			&& this.ResponseStatus != 304)
		{
			this.ResponseStatus = requestEvent.ResponseStatus;
			this.ResponseStatusText = requestEvent.ResponseStatusText;
		}
		
		if (requestEvent.Context != null) 
		{
			this.Context = requestEvent.Context;
		}
		
		if (this.LoadFlags == null)
		{
			this.LoadFlags = requestEvent.LoadFlags;
		}
		
		if (this.Status == null)
		{
			this.Status = requestEvent.Status;
		}
		
		if (this.Name == null)
		{
			this.Name = requestEvent.Name;
		}

		if (this.RequestSucceeded == null)
		{
			this.RequestSucceeded = requestEvent.RequestSucceeded;
		}

		
		if ((this.ContentType == null || this.ContentType == "application/x-unknown-content-type")
			&& requestEvent.ContentType != null)
		{
			this.ContentType = requestEvent.ContentType;
		}

		if (this.ContentCharset == null)
		{
			this.ContentCharset = requestEvent.ContentCharset;
		}

		if (requestEvent.ContentLength != null && this.ContentLength != requestEvent.ContentLength)
		{
			this.ContentLength = requestEvent.ContentLength;
		}
		
		if (this.RequestSucceeded == null)
		{
			this.RequestSucceeded = requestEvent.RequestSucceeded;
		}
		
		if (this.IsNoStoreResponse == null)
		{
			this.IsNoStoreResponse = requestEvent.IsNoStoreResponse;
		}
		
		if (this.IsNoCacheResponse == null)
		{
			this.IsNoCacheResponse = requestEvent.IsNoCacheResponse;
		}
		
		if (this.EntityId == null)
		{
			this.EntityId = requestEvent.EntityId;
		}
		
		if (this.Priority == null)
		{
			this.Priority = requestEvent.Priority;
		}

		// cache info stuff
		if (requestEvent.EventSource == this.HttpFox.HttpFoxEventSourceType.SCANNED_COMPLETE
			&& !this.HasReceivedResponseHeaders
			&& this.ResponseStatus == 200)
		{
			this.IsFromCache = true;
		}
		
		if (this.IsFromCache != true && requestEvent.IsFromCache != null)
		{
			this.IsFromCache = requestEvent.IsFromCache;
		}
	
		if (this.HasCacheInfo != true && requestEvent.HasCacheInfo)
		{
			this.HasCacheInfo = requestEvent.HasCacheInfo;
		}
		if (requestEvent.HasCacheInfo)
		{
			if (this.CacheToken == null)
			{
				this.CacheToken = requestEvent.CacheToken;
			}
			if (this.CacheKey == null)
			{
				this.CacheKey = requestEvent.CacheKey;
			}
			if (this.ContentCharset == null)
			{
				this.ContentCharset = requestEvent.ContentCharset;
			}
			if (this.ContentCharset == null)
			{
				this.ContentCharset = requestEvent.ContentCharset;
			}
		}
		
		if (this.CacheToken_key == null && requestEvent.CacheToken_key != null)
		{
			this.CacheToken_key = requestEvent.CacheToken_key;
		}
		if (requestEvent.CacheToken_clientID != null)
		{
			this.CacheToken_clientID = requestEvent.CacheToken_clientID;
		}
		if (requestEvent.CacheKey != null)
		{
			this.CacheKey = requestEvent.CacheKey;
			//alert('token key: ' + this.CacheKey);
		}
		
		// custom properties
		if (requestEvent.RequestHeaders != null)
		{
			this.RequestHeaders = requestEvent.RequestHeaders;
		}

		if (requestEvent.ResponseHeaders != null)
		{
			this.ResponseHeaders = requestEvent.ResponseHeaders;
		}

		if (requestEvent.CookiesSent != null)
		{
			this.CookiesSent = requestEvent.CookiesSent;
		}
		
		if (requestEvent.CookiesReceived != null)
		{
			this.CookiesReceived = requestEvent.CookiesReceived;
		}

		// POST data
		if (requestEvent.PostDataHeaders != null)
		{
			this.PostDataHeaders = requestEvent.PostDataHeaders;
		}

		if (requestEvent.PostData != null)
		{
			this.PostData = requestEvent.PostData;
		}

		if (requestEvent.PostDataParameters != null)
		{
			this.PostDataParameters = requestEvent.PostDataParameters;
		}

		if (requestEvent.PostDataMIMEParts != null)
		{
			this.PostDataMIMEParts = requestEvent.PostDataMIMEParts;
		}

		if (requestEvent.IsPostDataMIME != null)
		{
			this.IsPostDataMIME = requestEvent.IsPostDataMIME;
		}

		if (requestEvent.PostDataMIMEBoundary != null)
		{
			this.PostDataMIMEBoundary = requestEvent.PostDataMIMEBoundary;
		}
		
		if (requestEvent.IsPostDataTooBig != null)
		{
			this.IsPostDataTooBig = requestEvent.IsPostDataTooBig;
		}
		
		//QueryString: null,
		if (requestEvent.QueryString != null)
		{
			this.QueryString = requestEvent.QueryString;
		}
		//QueryStringParameters: null,
		if (requestEvent.QueryStringParameters != null)
		{
			this.QueryStringParameters = requestEvent.QueryStringParameters;
		}
		//IsBackground: false,
		if (requestEvent.IsBackground != null)
		{
			this.IsBackground = requestEvent.IsBackground;
		}
		
		if (requestEvent.EventSource == this.HttpFox.HttpFoxEventSourceType.ON_MODIFY_REQUEST)
		{
			// calc header size
			this.RequestHeadersSize = this.calcRequestHeadersSize(requestEvent);
			this.getRequestContentLength(requestEvent);
		}
		
		if (requestEvent.EventSource == this.HttpFox.HttpFoxEventSourceType.ON_EXAMINE_RESPONSE)
		{
			// calc header size
			this.RequestHeadersSize = this.calcRequestHeadersSize(this);
			this.ResponseHeadersSize = this.calcResponseHeadersSize(requestEvent);
		}
		
		// update bytes loaded/total
		// BytesLoaded: 0,
		if (this.IsSending) 
		{
			if (this.BytesSent < requestEvent.progress)
			{
				this.BytesSent = requestEvent.progress;
			}
 
			// take sent total from contentlength
			this.BytesSentTotal = (this.PostDataContentLength ? this.PostDataContentLength : 0) + this.RequestHeadersSize;
		}
		else
		{
			if (this.BytesLoaded < requestEvent.progress)
			{
				this.BytesLoaded = requestEvent.progress;
			}
			// BytesLoadedTotal: 0,
			if (this.BytesLoadedTotal < requestEvent.progressMax)
			{
				this.BytesLoadedTotal = requestEvent.progressMax;
			}
		}
		
		// if no info on bytes loaded, just use the contentLength value
		if (this.IsFinished 
			&& (this.BytesLoaded == 0 || this.BytesLoaded == -1) 
			&& this.ContentLength != -1)
		{
			this.BytesLoaded = this.ContentLength;
		}
		
	},
	
	getRequestContentLength: function(requestEvent)
	{
		for (var i in requestEvent.PostDataHeaders)
		{
			if (i.toLowerCase() == "content-length")
			{
				this.PostDataContentLength = parseInt(requestEvent.PostDataHeaders[i]);
				return;
			}
		}
		
		for (var i in requestEvent.RequestHeaders)
		{
			if (i.toLowerCase() == "content-length")
			{
				this.PostDataContentLength = parseInt(requestEvent.RequestHeaders[i]);
				return;
			}
		}
	},
	
	calcRequestHeadersSize: function(requestEvent)
	{
		var byteString = "";
		byteString += requestEvent.RequestMethod + " " + requestEvent.URIPath + " HTTP/" + requestEvent.RequestProtocolVersion + "\r\n";
		
		for (var i in requestEvent.RequestHeaders)
		{
			byteString += i + ": " + requestEvent.RequestHeaders[i] + "\r\n";
		}
		
		for (var i in requestEvent.PostDataHeaders)
		{
			byteString += i + ": " + requestEvent.PostDataHeaders[i] + "\r\n";
		}
		
		byteString += "\r\n";
		
		return byteString.length;
	},
	
	calcResponseHeadersSize: function(requestEvent)
	{
		var byteString = "";
		byteString += "HTTP/" + requestEvent.ResponseProtocolVersion + " " + requestEvent.ResponseStatus + " " + requestEvent.ResponseStatusText + "\r\n";
		
		for (var i in requestEvent.ResponseHeaders)
		{
			byteString += i + ": " + requestEvent.RequestHeaders[i] + "\r\n";
		}
		
		byteString += "\r\n";
		
		return byteString.length;
	},
	
	//M -> provide callback
	startGetRawContent: function(callback)
	{
		this.CallbackController = callback;
		
		if (this.Content != null && this.ContentStatus != null) 
		{
			this.CallbackController.showRawContent(this.ContentStatus);
			return;
		}
		
		if (this.Context != null) {
			//TODO: CHECK IF CACHEKEY_AFTER EXISTS
			if (!this.CacheKey_After)
			{
				//not ready
				//this.Content = "not ready";
				this.CallbackController.showRawContent(-1);
				return;
			}
			
			this.Context.sourceCache.loadData(this.Url, this.PostData, this.CacheKey_After, this);
		}
	},
	
	//M -> use callback
	endGetRawContent: function(data, status)
	{
		var result = this.AmfParserInstance.parseContent(data);
		if (result === undefined) {
			this.Content = data;
		}
		else {
			this.Content = result;
		}
		this.ContentStatus = status;
		this.CallbackController.showRawContent(status);
	},
	
	//M
	showCacheInfo: function() 
	{
		if (!this.HasCacheInfo) 
		{
			this.HttpFox.addHeaderRow("hf_CacheInfoChildren", "(none)", "(This request was not served from cache)");
			return;
		}
	
		try 
		{
			var CacheInfo = this.CacheToken.QueryInterface(Components.interfaces.nsICacheEntryInfo);
			
			this.HttpFox.addHeaderRow("hf_CacheInfoChildren", "Key", CacheInfo.key);
			this.HttpFox.addHeaderRow("hf_CacheInfoChildren", "Expires", utils.formatDateTime(CacheInfo.expirationTime));
			this.HttpFox.addHeaderRow("hf_CacheInfoChildren", "Hit Count", CacheInfo.fetchCount);
			this.HttpFox.addHeaderRow("hf_CacheInfoChildren", "Last Hit", utils.formatDateTime(CacheInfo.lastFetched));
			this.HttpFox.addHeaderRow("hf_CacheInfoChildren", "Last Modification", utils.formatDateTime(CacheInfo.lastModified));
			this.HttpFox.addHeaderRow("hf_CacheInfoChildren", "Client ID", CacheInfo.clientID);
			this.HttpFox.addHeaderRow("hf_CacheInfoChildren", "Device ID", CacheInfo.deviceID);
			this.HttpFox.addHeaderRow("hf_CacheInfoChildren", "Size", CacheInfo.dataSize);
			
			if (this.CacheFile != null) 
			{
				var CacheFileInfo = this.CacheFile.QueryInterface(Components.interfaces.nsIFile);
				
				this.HttpFox.addHeaderRow("hf_CacheInfoChildren", "Filename", CacheFileInfo.leafName);
				this.HttpFox.addHeaderRow("hf_CacheInfoChildren", "Filepath", CacheFileInfo.target);
				this.HttpFox.addHeaderRow("hf_CacheInfoChildren", "Filesize", CacheFileInfo.fileSize);
				this.HttpFox.addHeaderRow("hf_CacheInfoChildren", "File Last Modification", utils.formatDateTime(CacheFileInfo.lastModifiedTime / 1000));
			}
			else
			{
				this.HttpFox.addHeaderRow("hf_CacheInfoChildren", "Filename", "n/a");
			}
		} 
		catch (ex)
		{
			this.HttpFox.addHeaderRow("hf_CacheInfoChildren", "(error)", "(There was an error accessing the cache information)");
		}
	},
		
	setFinished: function()
	{
		this.IsFinished = true;
		if (!this.EndTimestamp)
		{
			this.setEndTimestampNow();	
		}
	},
	
	setAborted: function()
	{
		this.IsAborted = true;
		this.IsFinished = true;
		this.setEndTimestampNow();
	},
	
	setStartTimestampNow: function()
	{
		this.StartTimestamp = (new Date()).getTime();
	},
	
	setEndTimestampNow: function()
	{
		this.EndTimestamp = (new Date()).getTime();
	},
	
	logEvent: function(logdata)
	{
		this.RequestLog.push(logdata);
	},
	
	getBytesLoaded: function()
	{
		if (this.RequestMethod == "HEAD")
		{
			return this.ResponseHeadersSize;
		}
		
		return this.ResponseHeadersSize + this.BytesLoaded;
	},
	
	getBytesLoadedTotal: function()
	{
		if (this.RequestMethod == "HEAD")
		{
			return this.ResponseHeadersSize;
		}
		
		return this.ResponseHeadersSize + this.BytesLoadedTotal;
	},
	
	getBytesSent: function()
	{
		return this.RequestHeadersSize + this.BytesSent;
	},
	
	getBytesSentTotal: function()
	{
		return this.RequestHeadersSize + this.PostDataContentLength;
	},
	
	complete: function()
	{
		this.IsFinal = true;
		
		this.IsSending = false;
		
		this.setFinished();
		
		try 
		{
			this.Status = this.HttpChannel.status;
			this.CacheKey_After = this.HttpChannel.cacheKey;
		}
		catch(exc) 
		{
		}
		
		if (this.Status == utils.HttpFoxNsResultErrors.NS_BINDING_ABORTED)
		//if (this.Status != 0)
		{
			// aborted
			this.setAborted();
			//return;
		}
		
		this.updateFromRequestEvent(
			new HttpFoxRequestEvent(
				this.HttpFox, 
				this.HttpChannel, 
				this.HttpFox.HttpFoxEventSourceType.SCANNED_COMPLETE, 
				null, 
				utils.getContextFromRequest(this.HttpChannel)));
		
		try {
			// release httpchannel, listeners and context
			if (this.HttpChannel.loadGroup && this.HttpChannel.loadGroup.groupObserver) {
				var go = HttpChannel.loadGroup.groupObserver;
				go.QueryInterface(Components.interfaces.nsIWebProgress);
				try 
				{
					go.removeProgressListener(this.HttpFox.Observer);
				}
				catch(ex) 
				{}
			}
			
			this.HttpFoxRequestEventSink.HttpChannel.notificationCallbacks = this.HttpFoxRequestEventSink.OriginalNotificationCallbacks;
			this.HttpFoxRequestEventSink = null;
			this.HttpChannel = null;
			
		}
		catch(e)
		{
			//dump("\nexc: " + e);
		}
		
		return;
	},

	isContentAvailable : function() 
	{
		if (this.isRedirect())
			//|| this.isError()
			//|| this.IsAborted)
		{
			return false;
		}
		
		if (this.RequestMethod == "HEAD")
		{
			return false;
		}
		
		return true;
	},
   
	hasErrorCode : function() 
	{
		if (this.Status && !this.isRedirect())
		{
			return true;
		}
		
		return false;
	},
	
	isRedirect : function()
	{
		if (this.Status && this.Status == utils.HttpFoxNsResultErrors.NS_BINDING_REDIRECTED) 
		{
			return true;
		}
		
		return false;
	},
	
	isError : function()
	{
		if (this.IsFinished && this.hasErrorCode() && !this.ResponseStatus)
		{
			return true;
		}
		
		return false;
	},
	
	isHTTPS : function()
	{
		if (this.URIScheme == "https")
		{
			return true;
		}
		
		return false;
	}

}
// ************************************************************************************************

// HttpFoxRequestEvent
function HttpFoxRequestEvent(HttpFoxReference, HttpChannelReference, EventSourceType, EventSourceMiscData, HttpFoxContext)
{
	try 
	{
		this.HttpChannel = HttpChannelReference.QueryInterface(Components.interfaces.nsIHttpChannel);
	}
	catch(ex) 
	{
		// discard that non-httpchannel thing
		return
	}
	
	this.HttpFox = HttpFoxReference;
	this.EventSource = EventSourceType;
	this.EventSourceData = EventSourceMiscData;
	this.Context = HttpFoxContext;
	
	this.init();
}
HttpFoxRequestEvent.prototype = 
{
	HttpFox: null, // reference
	HttpChannel: null, // reference
	EventSource: null,
	EventSourceData: null,
	Context: null, // reference
	HttpFoxRequestEventSink: null,

	// custom request properties
	BytesLoaded: 0,
	BytesLoadedTotal: 0,
	Timestamp: null,
	HasCacheInfo: false,
	
	// request/response data
	RequestHeaders: null,
	ResponseHeaders: null,
	PostDataHeaders: null,
	PostData: null,
	PostDataParameters: null,
	IsPostDataMIME: null,
	PostDataMIMEBoundary: null,
	PostDataMIMEParts: null,
	IsPostDataTooBig: false,
	QueryString: null,
	QueryStringParameters: null,
	CookiesSent: null,
	CookiesReceived: null,
	IsBackground: false, //?
	
	// httpchannel-, request properties
	Status: null,
	Url: null,
	URIPath: null,
	URIScheme: null,
	RequestProtocolVersion: null,
	RequestMethod: null,
	ResponseProtocolVersion: null,
	ResponseStatus: null,
	ResponseStatusText: null,
	ContentType: null,
	ContentCharset: null,
	ContentLength: null,
	LoadFlags: null,
	Name: null,
	RequestSucceeded: null,
	IsNoStoreResponse: null,
	IsNoCacheResponse: null,
	IsFromCache: null,
	CacheToken: null,
	CacheToken_key: null,
	CacheKey: null,
	CacheAsFile: null,
	CacheFile: null,
	Priority: null,
	IsPending: null,
	EntityId: null,
	
	init: function()
	{
		this.Timestamp = (new Date()).getTime();
		
		// get properties from httpchannel/request object
		this.Status = this.HttpChannel.status ? this.HttpChannel.status : null;
		this.Url = this.HttpChannel.URI ? this.getFinalUrl(this.HttpChannel.URI.asciiSpec) : null;
		this.URIScheme = this.HttpChannel.URI ? this.HttpChannel.URI.scheme : null;
		this.URIPath = this.HttpChannel.URI ? this.getFinalUrl(this.HttpChannel.URI.path) : null;
		this.Name = this.HttpChannel.name ? this.HttpChannel.name : null;
		this.RequestMethod = this.HttpChannel.requestMethod ? this.HttpChannel.requestMethod : null;
		this.IsPending = this.HttpChannel.isPending();
		this.LoadFlags = this.HttpChannel.loadFlags;
		this.Priority = this.HttpChannel.priority ? this.HttpChannel.priority : null;
		this.IsBackground = this.LoadFlags & Components.interfaces.nsIRequest.LOAD_BACKGROUND;

		// cache infos
		//TODO: CLEAN UP
		this.getCacheInfos();
		
		// get response related infos
		try { this.ContentType = this.HttpChannel.contentType; } catch(ex) {}
		try { this.ContentCharset = this.HttpChannel.ContentCharset; } catch(ex) {}
		try { this.ContentLength = this.HttpChannel.contentLength; } catch(ex) {}
		try { this.RequestSucceeded = this.HttpChannel.requestSucceeded; } catch(ex) {}
		try { this.ResponseStatus = this.HttpChannel.responseStatus; } catch(ex) {}
		try { this.ResponseStatusText = this.HttpChannel.responseStatusText; } catch(ex) {}
		try { this.IsNoStoreResponse = this.HttpChannel.isNoStoreResponse(); } catch(ex) {}
		try { this.IsNoCacheResponse = this.HttpChannel.isNoCacheResponse(); } catch(ex) {}
		try { this.EntityId = this.HttpChannel.EntityId; } catch(ex) {}
		
		// event specific infos
		if (this.EventSource == this.HttpFox.HttpFoxEventSourceType.ON_MODIFY_REQUEST)
		{
			// Get Request Headers
			var dummyHeaderInfo = new HttpFoxHeaderInfo();
			this.HttpChannel.visitRequestHeaders(dummyHeaderInfo);
			this.RequestHeaders = dummyHeaderInfo.Headers;
			
			// Get QueryString if there.
			this.getQueryString();
			
			// Get Cookie Sent Infos
			this.getCookiesSent();
			
			// Get post data if there.
			this.getPostData();
			
			// Get request protocol version
			this.getRequestProtocolVersion();
		}
		
		if (this.EventSource == this.HttpFox.HttpFoxEventSourceType.ON_EXAMINE_RESPONSE)
		{
			// ok. received a server response.
			// Get Request Headers again. maybe be changed after us. (e.g. cache-control)
			var dummyHeaderInfo = new HttpFoxHeaderInfo();
			this.HttpChannel.visitRequestHeaders(dummyHeaderInfo);
			this.RequestHeaders = dummyHeaderInfo.Headers;

			// Get Response Headers
			var dummyHeaderInfo = new HttpFoxHeaderInfo();
			this.HttpChannel.visitResponseHeaders(dummyHeaderInfo);
			this.ResponseHeaders = dummyHeaderInfo.Headers;
			
			// Get Cookies Received Infos
			this.getCookiesReceived();
			
			// Get response protocol version
			this.getResponseProtocolVersion();
		}
		
		if (this.EventSource == this.HttpFox.HttpFoxEventSourceType.EVENTSINK_ON_PROGRESS)
		{
			// update byte count
			this.BytesLoaded = this.EventSourceData["progress"];
			this.BytesLoadedTotal = this.EventSourceData["progressMax"];
		}
		
		if (this.EventSource == this.HttpFox.HttpFoxEventSourceType.WEBPROGRESS_ON_PROGRESS_CHANGED)
		{
			// update byte count
			this.BytesLoaded = this.EventSourceData["curSelfProgress"];
			this.BytesLoadedTotal = this.EventSourceData["maxSelfProgress"];
		}
	},
	
	getFinalUrl: function(channelUri)
	{
		return channelUri.split("#")[0];
	},

	getRequestProtocolVersion: function()
	{
		try 
		{
			var httpChannelInternal = this.HttpChannel.QueryInterface(Components.interfaces.nsIHttpChannelInternal);
			var ver1 = new Object;
			var ver2 = new Object;
			httpChannelInternal.getRequestVersion(ver1, ver2);
			this.RequestProtocolVersion = ver1.value + "." + ver2.value;
		}
		catch(ex)
		{
			return;
		}
	},
	
	getResponseProtocolVersion: function()
	{
		try 
		{
			var httpChannelInternal = this.HttpChannel.QueryInterface(Components.interfaces.nsIHttpChannelInternal);
			var ver1 = new Object;
			var ver2 = new Object;
			httpChannelInternal.getResponseVersion(ver1, ver2);
			this.ResponseProtocolVersion = ver1.value + "." + ver2.value;
		}
		catch(ex)
		{
			return;
		}
	},
	
	getCacheInfos: function()
	{
		// cache infos
		if (this.HttpChannel instanceof Components.interfaces.nsICachingChannel) 
		{
			this.HttpChannel.QueryInterface(Components.interfaces.nsICachingChannel);
		}
		else
		{
			return;
		}
		
		try {
			this.IsFromCache = this.HttpChannel.isFromCache();
		}
		catch(ex) 
		{
			this.IsFromCache = false;
		}

		/*
		//if (this.IsFromCache)
		//{
			try 
			{
				var CacheInfo = this.HttpChannel.cacheToken.QueryInterface(Components.interfaces.nsICacheEntryInfo);
				if (CacheInfo instanceof Components.interfaces.nsICacheEntryDescriptor)
				{
					//this.CacheToken = this.HttpChannel.cacheToken;
					this.CacheToken_clientID = CacheInfo.clientID;
					this.CacheToken_key = CacheInfo.key;
					this.HasCacheInfo = true;
					//alert('c_id: ' + CacheInfo.clientID + ' - c key: ' + CacheInfo.key);
				}
			} 
			catch(ex) {
				return;
			}
		if (this.IsFromCache)
		{
			try 
			{
				this.CacheKey = this.HttpChannel.cacheKey;
				this.HasCacheInfo = true;
			} 
			catch(ex) {}
				
			try 
			{
				this.CacheAsFile = this.HttpChannel.cacheAsFile;
				this.HasCacheInfo = true;
			} 
			catch(ex) {}
				
			try 
			{
				this.CacheFile = this.HttpChannel.cacheFile;
				this.HasCacheInfo = true;
			} 
			catch(ex) {}
		}*/
		/*else 
		{
			var token;
			if (this.HttpChannel instanceof Components.interfaces.nsICachingChannel) 
			{
				try
				{
					token = this.HttpChannel.cacheToken;
					alert('cache token: ' + token);
				} catch (ex)
				{
					alert('exc cache token: ' + ex)
				}
			}
			else {
				//alert('no cache info');
			}
		}*/
	},
	
	getPostData: function()
	{
		// Get the postData stream from the Http Object 
		try 
		{
			// Must change HttpChannel to UploadChannel to be able to access post data
			var postChannel = this.HttpChannel.QueryInterface(Components.interfaces.nsIUploadChannel);

			// Get the post data stream
			if (postChannel.uploadStream) 
			{
				this.PostDataChannel = postChannel;
				var PostDataHandler = new HttpFoxPostDataHandler(this);
				PostDataHandler.getPostData();
			} 
	    } 
	    catch(ex) 
	    {
	    }
	},
	
	getQueryString: function() {
		if (this.Url.indexOf("?") == -1) 
		{
			return;
		}
		this.QueryString = this.Url.slice(this.Url.indexOf("?") + 1, this.Url.length);
		
		this.QueryStringParameters = new Array();
		var queryStringParts = this.QueryString.split("&");
		for (i in queryStringParts)
		{
			var nvName = queryStringParts[i].slice(0, queryStringParts[i].indexOf("=") != -1 ? queryStringParts[i].indexOf("=") : queryStringParts[i].length);
			var nvValue = (queryStringParts[i].indexOf("=") != -1) ? queryStringParts[i].slice(queryStringParts[i].indexOf("=") + 1, queryStringParts[i].length) : "";
			this.QueryStringParameters.push([nvName, nvValue]);
		}
	},
	
	getCookiesSent: function() {
		this.CookiesSent = new Array();
		
		var CookiesStored = utils.getStoredCookies(this.RequestHeaders["Host"], this.URIPath);
		
		if (this.RequestHeaders["Cookie"]) {
			var requestCookies = this.RequestHeaders["Cookie"].split("; ");
			for (i in requestCookies) {
				var cName = requestCookies[i].slice(0, requestCookies[i].indexOf("="));
				var cValue = requestCookies[i].slice(cName.length + 1);
				
				var cookieData = new Array();
				cookieData["name"] = cName;
				cookieData["value"] = cValue;
				
				for (var i = 0; i < CookiesStored.length; i++)
				{
					if (CookiesStored[i].name == cName && CookiesStored[i].value == cValue) 
					{
						cookieData["domain"] = CookiesStored[i].host;
						cookieData["expires"] = CookiesStored[i].expires;
						cookieData["path"] = CookiesStored[i].path;
						CookiesStored.splice(i, 1);
						break;
					}
				}
				
				this.CookiesSent.push(cookieData);
			}
		}
	},
	
	getCookiesReceived: function() {
		this.CookiesReceived = new Array();
		
		if (this.ResponseHeaders["Set-Cookie"]) 
		{
			var responseCookies = this.ResponseHeaders["Set-Cookie"].split("\n");
			for (i in responseCookies) 
			{
				var dataSections = responseCookies[i].split(";");
				var cName = dataSections[0].slice(0, dataSections[0].indexOf("="));
				var cValue = dataSections[0].slice(cName.length + 1);
				var cookieData = new Array();
				cookieData["name"] = utils.trim(cName, 'left');
				cookieData["value"] = cValue;
				
				// other infos
				for (var u = 1; dataSections[u] != null; u++) 
				{
					var cInfoName = dataSections[u].slice(1, dataSections[u].indexOf("="));
					var cInfoValue = dataSections[u].slice(cInfoName.length + 2);
					cookieData[cInfoName.toLowerCase()] = cInfoValue;
				}
				
				if (!cookieData["domain"])
				{
					cookieData["domain"] = this.RequestHeaders["Host"];
				}
				
				if (!cookieData["path"]) 
				{
					cookieData["path"] = "/";
				}
				
				// check against stored one
				var CookiesStored = utils.getStoredCookies(cookieData["domain"], cookieData["path"]);
				for (var i = 0; i < CookiesStored.length; i++)
				{
					if (CookiesStored[i].name == cName && CookiesStored[i].value == cValue && CookiesStored[i].path == cookieData["path"]) 
					{
						/*if (cookieData["expires"])
						{
							cookieData["expires"] = CookiesStored[i].expires;	
						}*/
						
						CookiesStored.splice(i, 1);
						break;
					}
				}
				
				this.CookiesReceived.push(cookieData);
			}
		}
	}
}
// ************************************************************************************************

// HttpFoxRequestEventSink
function HttpFoxRequestEventSink(HttpFoxReference, HttpChannel)
{
	this.init(HttpFoxReference, HttpChannel);
}
HttpFoxRequestEventSink.prototype =
{
	// Properties
	HttpFox: null,
	OriginalNotificationCallbacks: null,
	
	// Constructor
	init: function(HttpFoxReference, HttpChannel) 
	{
		this.HttpFox = HttpFoxReference;
		if (HttpChannel.notificationCallbacks != null) 
		{
			this.OriginalNotificationCallbacks = HttpChannel.notificationCallbacks;
		}
		HttpChannel.notificationCallbacks = this;
	},
	
	/**
	* See nsIProgressEventSink
	*/
	onProgress: function(request, context, progress, progressMax)
	{
		var eventSourceData = new Object();
		eventSourceData["progress"] = progress;
		eventSourceData["progressMax"] = progressMax;
		this.HttpFox.handleRequestEvent(new HttpFoxRequestEvent(this.HttpFox, request, this.HttpFox.HttpFoxEventSourceType.EVENTSINK_ON_PROGRESS, eventSourceData, utils.getContextFromRequest(request)));
		// forward to possible other notificationCallbacks
		try {
			if (this.OriginalNotificationCallbacks != null) 
			{
				var i = this.OriginalNotificationCallbacks.getInterface(Components.interfaces.nsIProgressEventSink);
				i.onProgress(request, context, progress, progressMax);
			}
		}
		catch(e) {}
	}, 
   
	onStatus: function(request, context, status, statusArg)
	{
		var eventSourceData = new Object();
		eventSourceData["status"] = status;
		eventSourceData["statusArg"] = statusArg;
		this.HttpFox.handleRequestEvent(new HttpFoxRequestEvent(this.HttpFox, request, this.HttpFox.HttpFoxEventSourceType.EVENTSINK_ON_STATUS, eventSourceData, utils.getContextFromRequest(request)));
		// forward to possible other notificationCallbacks
		try {
			if (this.OriginalNotificationCallbacks != null) 
			{
				var i = this.OriginalNotificationCallbacks.getInterface(Components.interfaces.nsIProgressEventSink);
				i.onStatus(request, context, status, statusArg);
			}
		}
		catch(e) {}
	}, 
	/************************************************/
	
	/**
	* nsISupports
	*/
	QueryInterface: function(iid) 
	{
		if (!iid.equals(Components.interfaces.nsISupports) &&
			!iid.equals(Components.interfaces.nsISupportsWeakReference) &&
			!iid.equals(Components.interfaces.nsIProgressEventSink))
		{
			throw Components.results.NS_ERROR_NO_INTERFACE;
		}
        
        return this;
    },
    /********************************************/
    
	/**
	* nsIInterfaceRequestor
	*/
	getInterface: function(iid)
	{
		if (iid.equals(Components.interfaces.nsIProgressEventSink))
		{
		  	return this;
		}
		
		try {
			if (this.OriginalNotificationCallbacks != null) 
			{
				return this.OriginalNotificationCallbacks;
			}
		}
		catch(e) {
			//dump("brrr: " + e);
			//dumpall("\n\n\n****EXC OBJECT IS", this.OriginalNotificationCallbacks);
		}
		
		Components.returnCode = Components.results.NS_ERROR_NO_INTERFACE;
		return null;
	}
	/********************************************/
}


// ************************************************************************************************

// HttpFoxObserver
function HttpFoxObserver(HttpFoxReference)
{
	this.init(HttpFoxReference);
}
HttpFoxObserver.prototype =
{
	// Properties
	HttpFox: null,
	
	// Constructor
	init: function(HttpFoxReference) 
	{
		this.HttpFox = HttpFoxReference;
	},
	
	// start observing
	start: function()
	{
		this.addListener();
	},
	
	// end observing
	stop: function()
	{
		this.removeListener();
	},
	
	addListener: function()
	{
		// Register listeners
		var observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
		observerService.addObserver(this, "http-on-modify-request", false);
		observerService.addObserver(this, "http-on-examine-response", false);
		observerService.addObserver(this, "http-on-examine-merged-response", false);
	},
	
	removeListener: function()
	{
		// Unregistering listeners
		var observerService = Components.classes["@mozilla.org/observer-service;1"].getService(Components.interfaces.nsIObserverService);
		observerService.removeObserver(this, "http-on-modify-request");
		observerService.removeObserver(this, "http-on-examine-response");
		observerService.removeObserver(this, "http-on-examine-merged-response");
	},
	
	// event related
	onModifyRequest: function(HttpChannel)
	{
		// force caching
		this.HttpFox.forceCaching(HttpChannel);
		
		var eventSourceData = new Object();

		// hook up more listeners
		HttpChannel.QueryInterface(Components.interfaces.nsIRequest);
		if (HttpChannel.loadGroup && HttpChannel.loadGroup.groupObserver) {
			// even more listeners
			var go = HttpChannel.loadGroup.groupObserver;
			go.QueryInterface(Components.interfaces.nsIWebProgress);
			try {
				go.addProgressListener(this, 0xFE); // 0x2 or 0xff
			}
			catch(ex) {
				// guess this means the request is aborted and/or cached.
			}
		}
		
		try {
			// assume it is always a new request
			var event = new HttpFoxRequestEvent(
				this.HttpFox, 
				HttpChannel, 
				this.HttpFox.HttpFoxEventSourceType.ON_MODIFY_REQUEST, 
				eventSourceData, 
				utils.getContextFromRequest(HttpChannel));
			
			event.HttpFoxRequestEventSink = new HttpFoxRequestEventSink(this.HttpFox, HttpChannel);
				
			this.HttpFox.handleRequestEvent(event);
			}
			  
		catch(e) 
		{
			dump("\n* Observer EXC: " + e + "\n");
		}
	},
	
	onExamineResponse: function(HttpChannel) 
	{
		var eventSourceData = new Object();
		this.HttpFox.handleRequestEvent(new HttpFoxRequestEvent(this.HttpFox, HttpChannel, this.HttpFox.HttpFoxEventSourceType.ON_EXAMINE_RESPONSE, eventSourceData, utils.getContextFromRequest(HttpChannel)));
	},
	
	onExamineMergedResponse: function(HttpChannel) 
	{
		var eventSourceData = new Object();
		this.HttpFox.handleRequestEvent(new HttpFoxRequestEvent(this.HttpFox, HttpChannel, this.HttpFox.HttpFoxEventSourceType.ON_EXAMINE_MERGED_RESPONSE, eventSourceData, utils.getContextFromRequest(HttpChannel)));
	},
	
	// INTERFACE IMPLEMENTATIONS
	/**
	/* nsIWebProgressListener
	/**/
	onStateChange: function(progress, request, flags, status)
	{
		var eventSourceData = new Object();
		eventSourceData["flags"] = flags;
		eventSourceData["status"] = status;
		this.HttpFox.handleRequestEvent(new HttpFoxRequestEvent(this.HttpFox, request, this.HttpFox.HttpFoxEventSourceType.WEBPROGRESS_ON_STATE_CHANGED, eventSourceData, utils.getContextFromRequest(request)));
	},
	
	onProgressChange: function(progress, request, curSelfProgress, maxSelfProgress, curTotalProgress, maxTotalProgress) 
	{
		var eventSourceData = new Object();
		eventSourceData["curSelfProgress"] = curSelfProgress;
		eventSourceData["maxSelfProgress"] = maxSelfProgress;
		eventSourceData["curTotalProgress"] = curTotalProgress;
		eventSourceData["maxTotalProgress"] = maxTotalProgress;
		this.HttpFox.handleRequestEvent(new HttpFoxRequestEvent(this.HttpFox, request, this.HttpFox.HttpFoxEventSourceType.WEBPROGRESS_ON_PROGRESS_CHANGED, eventSourceData, utils.getContextFromRequest(request)));
	},
	
	onLocationChange: function(progress, request, uri) 
	{
		var eventSourceData = new Object();
		eventSourceData["uri"] = uri;
		this.HttpFox.handleRequestEvent(new HttpFoxRequestEvent(this.HttpFox, request, this.HttpFox.HttpFoxEventSourceType.WEBPROGRESS_ON_LOCATION_CHANGED, eventSourceData, utils.getContextFromRequest(request)));
	},
	
	onStatusChange: function(progress, request, status, message) 
	{
		var eventSourceData = new Object();
		eventSourceData["status"] = status;
		eventSourceData["message"] = message;
		this.HttpFox.handleRequestEvent(new HttpFoxRequestEvent(this.HttpFox, request, this.HttpFox.HttpFoxEventSourceType.WEBPROGRESS_ON_STATUS_CHANGED, eventSourceData, utils.getContextFromRequest(request)));
	},
	
	onSecurityChange: function(progress, request, state) 
	{
		var eventSourceData = new Object();
		eventSourceData["state"] = state;
		this.HttpFox.handleRequestEvent(new HttpFoxRequestEvent(this.HttpFox, request, this.HttpFox.HttpFoxEventSourceType.WEBPROGRESS_ON_SECURITY_CHANGED, eventSourceData, utils.getContextFromRequest(request)));
	},
	/********************************************/
	
	/**
	* nsIObserver
	*/
	observe: function(subject, topic, data) 
	{
		if (topic == 'http-on-modify-request') 
		{
			subject.QueryInterface(Components.interfaces.nsIHttpChannel);
			this.onModifyRequest(subject);
		} 
		else if (topic == 'http-on-examine-response') 
		{
			subject.QueryInterface(Components.interfaces.nsIHttpChannel);
			this.onExamineResponse(subject);
		} 
		else if (topic == 'http-on-examine-merged-response') 
		{
			subject.QueryInterface(Components.interfaces.nsIHttpChannel);
			this.onExamineMergedResponse(subject);
		}
	},
	/*********************************************/
		
	/**
	* nsISupportsString
	*/
	data: "HttpFoxObserver",
	
	
	toString: function()
	{
		return "HttpFoxObserver";
	},
	/*********************************************/
	
	/**
	* nsISupports
	*/
	QueryInterface: function(iid) 
	{
		if (!iid.equals(Components.interfaces.nsISupports) &&
			!iid.equals(Components.interfaces.nsISupportsWeakReference) &&
			!iid.equals(Components.interfaces.nsIObserver) &&
			!iid.equals(Components.interfaces.nsIWebProgressListener) &&
			!iid.equals(Components.interfaces.nsIURIContentListener) &&
			!iid.equals(Components.interfaces.nsIStreamListener) &&
			!iid.equals(Components.interfaces.nsIRequestObserver) &&
			!iid.equals(Components.interfaces.nsISupportsString))
		{
			throw Components.results.NS_ERROR_NO_INTERFACE;
		}
        
        return this;
    }
    /********************************************/
}
// ************************************************************************************************

function HttpFoxContext(win, browser, chrome, persistedState)
{
    this.windows = [];    
    this.panelMap = {};
    this.sidePanelNames = {};
    this.sourceCache = new HttpFoxSourceCache(win);
}
// ************************************************************************************************

// HttpFoxSourceCache
function HttpFoxSourceCache(win)
{
	this.charset = null;
	if (win != null) {
   		this.charset = win.document.characterSet;
	}
    this.cache = {};
}

HttpFoxSourceCache.prototype =
{
    loadText: function(url)
    {
        var lines = this.load(url);
        return lines ? lines.join("\n") : null;
    },
	
	loadData: function(url, myPostData, ckey, request)
    {
        var data = this.load(url, myPostData, ckey, request);
		return data;
    },
        
    load: function(url, myPostData, ckey, request)
    {
		var ioService = Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService);

        var channel;
        try
        {
            channel = ioService.newChannel(url, null, null);
            channel.loadFlags |= utils.LOAD_FROM_CACHE | utils.LOAD_TARGETED | utils.VALIDATE_NEVER;
			channel.owner = new HttpFoxResponseLoaderFlagger();
        }
        catch(ex)
        {
            return;
        }

		if (channel instanceof Components.interfaces.nsIUploadChannel)
		{
			if (myPostData) 
			{
		    	var inputStream = Components.classes["@mozilla.org/io/string-input-stream;1"].createInstance(Components.interfaces.nsIStringInputStream);
				inputStream.setData(myPostData, myPostData.length);

				var postStream = inputStream.QueryInterface(Components.interfaces.nsISeekableStream);
				postStream.seek(0, 0);
		        
		        var uploadChannel = channel.QueryInterface(Components.interfaces.nsIUploadChannel);
		        uploadChannel.setUploadStream(postStream, "application/x-www-form-urlencoded", -1);
		       	
		        var cachingChannel = channel.QueryInterface(Components.interfaces.nsIHttpChannel);
		        var httpChannel = channel.QueryInterface(Components.interfaces.nsIHttpChannel);
		        httpChannel.requestMethod = "POST";
		    }
		}
		
		if (channel instanceof Components.interfaces.nsICachingChannel)
		{
		    var cacheChannel = channel.QueryInterface(Components.interfaces.nsICachingChannel);
		    cacheChannel.loadFlags |= utils.LOAD_ONLY_FROM_CACHE | utils.VALIDATE_NEVER;
		    cacheChannel.cacheKey = ckey;
		}
        
        var stream;
        try
        {
        	var listener = new HttpFoxSourceCacheStreamListener(url, this, request, this.charset);
            channel.asyncOpen(listener, null);
        }
        catch(ex)
        {
            return;
        }
        
    },
    
    loadAsync: function(url, cb)
    {
        if (url in this.cache)
        {
            cb(this.cache[url], url);
            return;
        }

        var ioService = Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService);

        var channel = ioService.newChannel(url, null, null);
        channel.loadFlags |= utils.LOAD_FROM_CACHE | utils.LOAD_BYPASS_LOCAL_CACHE_IF_BUSY;

        var listener = new HttpFoxSourceCacheStreamListener(url, this, cb);
        channel.asyncOpen(listener, null);            
    } 
}
// ************************************************************************************************

// HttpFoxSourceCacheStreamListener
function HttpFoxSourceCacheStreamListener(url, cache, request, charset)
{
	this.request = request;
	this.charset = charset;
    this.url = url;
    this.cache = cache;
    this.data = "";
}

HttpFoxSourceCacheStreamListener.prototype =
{
    onStartRequest: function(request, context)
    {},

    onStopRequest: function(request, context, status)
    {
        this.done = true;
        
        if (status != utils.NS_BINDING_ABORTED)
        {
            context = this.data;
            this.request.endGetRawContent(utils.convertToUnicode(this.data, this.charset), status);
        }
    },

    onDataAvailable: function(request, context, inStr, sourceOffset, count)
    {
        this.data += utils.readFromStream_Binary(inStr, this.charset);
    }
};
// ************************************************************************************************

// HttpFoxResponseLoaderFlagger
function HttpFoxResponseLoaderFlagger() 
{}
HttpFoxResponseLoaderFlagger.prototype =
{
	data: "HttpFoxResponseLoaderFlagger",
	
	toString: function()
	{
		return "HttpFoxResponseLoaderFlagger";
	},
	
    QueryInterface: function(iid)
    {
        if (iid.equals(Components.interfaces.nsISupportsString) ||
			iid.equals(Components.interfaces.nsISupports))
            return this;
        throw Components.results.NS_NOINTERFACE;
    }
}
// ************************************************************************************************



// HttpFoxHeaderInfo
function HttpFoxHeaderInfo()
{
	this.init();
}
HttpFoxHeaderInfo.prototype = 
{
	Headers: null,
	
	init: function()
	{
		this.Headers = new Array();
	},
	
	visitHeader: function(name, value)
	{
		this.Headers[name] = value;
	}
}
// ************************************************************************************************


// HttpFoxPostDataHandler
// Contains code from LiveHeaders and TamperData
function HttpFoxPostDataHandler(hfRequest) 
{
	this.request = hfRequest;
	this.request.IsPostDataMIME = false;
	this.seekablestream = this.request.HttpChannel.uploadStream.QueryInterface(Components.interfaces.nsISeekableStream);
	this.stream = Components.classes["@mozilla.org/scriptableinputstream;1"].createInstance(Components.interfaces.nsIScriptableInputStream);
	this.stream.init(this.seekablestream);

	// Check if the stream has headers
	this.hasheaders = false;
	this.body = 0;
	this.isBinary = true;
	if (this.seekablestream instanceof Components.interfaces.nsIMIMEInputStream) 
	{
		this.seekablestream.QueryInterface(Components.interfaces.nsIMIMEInputStream);
		this.hasheaders = true;
		this.body = -1; // Must read header to find body
		this.isBinary = false;
	} 
	else if (this.seekablestream instanceof Components.interfaces.nsIStringInputStream) 
	{
		this.seekablestream.QueryInterface(Components.interfaces.nsIStringInputStream);
		this.hasheaders = true;
		this.body = -1; // Must read header to find body
	}
	this.AmfParserInstance = new AmfParser();
}

HttpFoxPostDataHandler.prototype = 
{
	AmfParserInstance: null,
	rewind: function() 
	{
		this.seekablestream.seek(0, 0);
	},

	tell: function() 
	{
		return this.seekablestream.tell();
	},

	readLine: function() 
	{
		var line = "";
		var size = this.stream.available();
		for (var i = 0; i < size; i++) 
		{
			var c = this.stream.read(1);
			if (c == '\r') 
			{} 
			else if (c == '\n') 
			{
				break;
			} 
			else
			{
				line += c;
			}
		}
		return line;
	},

	getPostHeaders: function() 
	{
		if (this.hasheaders) 
		{
			this.rewind();
			var line = this.readLine();
			while(line) 
			{
				if (this.request) 
				{
					var tmp = line.split(/:\s?/);
					this.addPostHeader(tmp[0], tmp[1]);
					// check if MIME postdata
					if (tmp[0].toLowerCase() == "content-type" && tmp[1].indexOf("multipart") != "-1") 
					{
						this.isBinary = true;
						this.request.IsPostDataMIME = true;
						this.request.PostDataMIMEBoundary = "--" + tmp[1].split("boundary=")[1];
						if (this.request.PostDataMIMEBoundary.indexOf("\"") == 0)
						{
							this.request.PostDataMIMEBoundary = this.request.PostDataMIMEBoundary.substr(1, this.request.PostDataMIMEBoundary.length - 2);
						}
					}
				}
				line = this.readLine();
			}
			this.body = this.tell();
		}
	},
	
	addPostHeader: function(name, value)
	{
		if (!this.request.PostDataHeaders) 
		{
			this.request.PostDataHeaders = new Array;
		}
		this.request.PostDataHeaders[name] = value;
	},

	clearPostHeaders : function() 
	{
		if (this.request.PostDataHeaders) 
		{
			delete this.request.PostDataHeaders;
		}
	},
	
	getPostData: function() 
	{
		// Position the stream to the start of the body
		if (this.body < 0 || this.seekablestream.tell() != this.body) 
		{
			this.getPostHeaders();
		}
	
		var size = this.stream.available();
		if (size == 0 && this.body != 0) 
		{
			// whoops, there weren't really headers..
			this.rewind();
			this.clearPostHeaders();
			size = this.stream.available();
		}
		
		// read post body (only if non-binary/too big)
		var postString = "";
		
		try 
		{
			if (size < 500000)
			{
				// This is to avoid 'NS_BASE_STREAM_CLOSED' exception that may occurs
				// See bug #188328.
				for (var i = 0; i < size; i++) 
				{
					var c = this.stream.read(1);
					c ? postString += c : postString += '\0';
				}	
			}
			else 
			{
				this.request.IsPostDataTooBig = true;
			}
		} 
		catch(e)
		{
			dump("\nExc: " + e)
			return "" + ex;
		} 
		finally 
		{
			this.rewind();
		}
		
		var result = this.AmfParserInstance.parseContent(postString);
		if (result !== undefined) {
			postString = result;
		}
		
		// if mime than try to split in parts
		if (this.request.IsPostDataMIME) 
		{
			this.request.PostData = postString;
			this.request.PostDataMIMEParts = new Array();
			
			if (!this.request.IsPostDataTooBig)
			{
				var rawMimeParts = new Array();
				rawMimeParts = postString.split(this.request.PostDataMIMEBoundary);
				
				var ws = "\n";
				if (rawMimeParts[1].indexOf("\r\n") == 0)
				{
					ws = "\r\n";
				}
				else if (rawMimeParts[1].indexOf("\r") == 0)
				{
					ws = "\r";
				}
				
				for (var i = 1; rawMimeParts[i]; i++)
				{
					try 
					{
							
						var mimePartData = new Object();
						var rawMimePartParts = new Array();
						rawMimePartParts = rawMimeParts[i].split(ws + ws);	
						
						var varname = null;
						RegExp.lastIndex = 0;
						if (rawMimePartParts[0].match(/\bname="([^"]+)"/i)) 
						{
							varname = RegExp.$1;
						}
						if (!varname) 
						{
							RegExp.lastIndex = 0;
							if(rawMimePartParts[0].match(/\bname=([^\s:;]+)/i)) 
							{
								varname = RegExp.$1;
							}
						}
						
						if (varname != null)
						{
							var filename = null;
							RegExp.lastIndex = 0;
							if (rawMimePartParts[0].match(/\b(filename="[^"]*")/i)) 
							{
								filename = RegExp.$1;
							}
							if (!filename) 
							{
								RegExp.lastIndex = 0;
								if(rawMimePartParts[0].match(/\b(filename=[^\s:;]+)/i)) 
								{
									filename = RegExp.$1;
								}
							}
			
							var ctype = null;
							RegExp.lastIndex = 0;
							if (rawMimePartParts[0].match(/\b(Content-type:\s*"[^"]+)"/i)) 
							{
								ctype = RegExp.$1;
							}
							if (!ctype) 
							{
								RegExp.lastIndex = 0;
								if (rawMimePartParts[0].match(/\b(Content-Type:\s*[^\s:;]+)/i)) {
									ctype = RegExp.$1;
								}
							}
							
							// value
							var value = utils.trim(rawMimePartParts[1]);
							
							mimePartData["varname"] = varname;
							mimePartData["filename"] = filename;
							mimePartData["ctype"] = ctype;
							mimePartData["value"] = value;
							
							this.request.PostDataMIMEParts.push(mimePartData);
						}
					}
					catch(e)
					{
						dump("\n\nEXC: " + e);
					}
				}
				
				return null;
			}
		}
		
		// strip off trailing \r\n's
		while (postString.indexOf("\r\n") == (postString.length - 2))
		{
			postString = postString.substring(0, postString.length - 2);
		}
		this.request.PostData = postString;
		
		// check if url parameter style
		if (this.request.PostData.match(/^&?([^=&<>]+=[^=&]*&?)+/i)) 
		{
			// split parameters (only non-mime bodies)
			this.request.PostDataParameters = new Array();
			var postDataParts = this.request.PostData.split("&");
			for (var i in postDataParts)
			{
				var nameValuePair = postDataParts[i].split("=");
				this.request.PostDataParameters.push([nameValuePair[0], nameValuePair[1]]);
			}
			return null;		
		}
		
		// no parseable content. display raw.
		this.request.PostDataParameters = null;
		return null;
	}
}
// ************************************************************************************************

// HttpFoxRequestLogData
function HttpFoxRequestLogData(request)
{
	this.init(request);
}
HttpFoxRequestLogData.prototype = 
{
	EventSource: null,
	EventSourceData: null,
	Timestamp: null,
	StateFlags: null,
	IsFromCache: null,
	Url: null,
	IsPending: null,
	BytesLoaded: null,
	BytesLoadedTotal: null,
	ResponseStatus: null,
	ResponseStatusText: null,
	Status: null,
	ContentType: null,
	ContentCharset: null,
	ContentLength: null,
	RequestSucceeded: null,
	IsNoStoreResponse: null,
	IsNoCacheResponse: null,
	EntityId: null,
	Priority: null,
	HasCacheInfo: null,
	
	init: function(request)
	{
		this.EventSource = request.EventSource;
		this.EventSourceData = new Object();
		for (i in request.EventSourceData)
		{
			this.EventSourceData[i] = request.EventSourceData[i];
		}
		this.Timestamp = request.Timestamp;
		this.StateFlags = request.StateFlags;
		this.IsFromCache = request.IsFromCache;
		this.Url = request.Url;
		this.IsPending = request.IsPending;
		this.BytesLoaded = request.BytesLoaded;
		this.BytesLoadedTotal = request.BytesLoadedTotal;
		this.ResponseStatus = request.ResponseStatus;
		this.ResponseStatusText = request.ResponseStatusText;
		this.Status = request.Status;
		this.ContentType = request.ContentType;
		this.ContentCharset = request.ContentCharset;
		this.ContentLength = request.ContentLength;
		this.RequestSucceeded = request.RequestSucceeded;
		this.IsNoStoreResponse = request.IsNoStoreResponse;
		this.IsNoCacheResponse = request.IsNoCacheResponse;
		this.EntityId = request.EntityId;
		this.Priority = request.Priority;
		this.HasCacheInfo = request.HasCacheInfo;
	}
}

// ************************************************************************************************
// UTIL FUNCTIONS
// ************************************************************************************************
var utils = {
	LOAD_FROM_CACHE: Components.interfaces.nsIRequest.LOAD_FROM_CACHE,
	VALIDATE_NEVER: Components.interfaces.nsIRequest.VALIDATE_NEVER,
	LOAD_TARGETED: Components.interfaces.nsIChannel.LOAD_TARGETED,
	LOAD_BYPASS_LOCAL_CACHE_IF_BUSY: Components.interfaces.nsICachingChannel.LOAD_BYPASS_LOCAL_CACHE_IF_BUSY,
	LOAD_ONLY_FROM_CACHE: Components.interfaces.nsICachingChannel.LOAD_ONLY_FROM_CACHE,
	NS_BINDING_ABORTED: 0x804b0002,

    trim: function(value, type)
    {
    	if (type == 'left') 
        {
            return value.replace(/^\s*/, '');
        }
	    if (type == 'right') 
        {
            return value.replace(/\s*$/, '');
        }
	    if (type == 'normalize') 
        {
            return trim(value.replace(/\s{2,}/g, ' '));
        }

	    return trim(trim(value, 'left'), 'right');
    },

	// Utility function, dump an object by reflexion up to niv level
	dumpall: function(name, obj, niv) 
	{
		if (!niv) {
			niv=1;
		}
		var dumpdict = new Object();
	
		dump ("\n\n-------------------------------------------------------\n");
		dump ("Dump of the object: " + name + " (" + niv + " levels)\n");
		dump ("Address: " + obj + "\n");
		dump ("Interfaces: ");
		
		for (var i in Components.interfaces) 
		{
			try 
			{
				obj.QueryInterface(Components.interfaces[i]);
				dump("" + Components.interfaces[i] + ", ");
			} 
			catch(ex) 
			{}
		}
		dump("\n");
		this._dumpall(dumpdict,obj,niv,"","");
		dump ("\n\n-------------------------------------------------------\n\n");
	
		for (i in dumpdict) 
		{
			delete dumpdict[i];
		}
	},
	
	_dumpall: function(dumpdict, obj, niv, tab, path) 
	{
		if (obj in dumpdict) 
		{
			dump(" (Already dumped)");
		} 
		else 
		{
			dumpdict[obj]=1;
			
			var i, r, str, typ;
			for (i in obj) 
			{
				try 
				{
					str = String(obj[i]).replace(/\n/g, "\n" + tab);
				} 
				catch(ex) 
				{
					str = String(ex);
				}
				try 
				{
					typ = "" + typeof(obj[i]);
				} 
				catch(ex) 
				{
					typ = "unknown";
				}
				dump ("\n" + tab + i + " (" + typ + (path ? ", " + path : "") + "): " + str);
				if ((niv > 1) && (typ == "object")) 
				{
					this._dumpall(dumpdict, obj[i], niv-1, tab + "\t", (path ? path + "->" + i : i));
				}
			}
		}
	},
	// ************************************************************************************************
	
	readFromStream_Binary: function(stream, charset)
	{
		var bstream = Components.classes["@mozilla.org/binaryinputstream;1"].createInstance(Components.interfaces.nsIBinaryInputStream);
		bstream.setInputStream(stream);
	
		var bytes = bstream.readBytes(bstream.available());
		return bytes;
	},
	//************************************************************************************************
	
	// context helper functions
	getContextFromWindow: function(win)
	{
		if (win == null) 
		{
			return new HttpFoxContext(null, null, null, false);
		}
		else 
		{
			var browser = this.getBrowserByWindow(win);
			var chrome = browser ? browser.chrome : null;
			return new HttpFoxContext(win, browser, chrome, false);	
		}
	},
	
	getContextFromRequest: function(request)
	{
		var win = null;
		var browser = null;
		
		try 
		{
			request.QueryInterface(Components.interfaces.nsIChannel);
		}
		catch(ex)
		{
			return new HttpFoxContext(null, null, null, false);
		}
		
		if (request.loadGroup == null || request.loadGroup.groupObserver == null) 
		{
			win = null;
			return new HttpFoxContext(null, null, null, false);
		}
		
		var go = request.loadGroup.groupObserver;
		go.QueryInterface(Components.interfaces.nsIWebProgress);
		win = go.DOMWindow;
		browser = this.getBrowserByWindow(win);
		var chrome = browser ? browser.chrome : null;
	
		return new HttpFoxContext(win, browser, chrome, false);
	},
	
	getBrowserByWindow: function(win)
	{
		return null;
	},
	// ************************************************************************************************
	
	convertToUnicode: function(text, charset)
	{
	    try
	    {
	        var conv = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].getService(Components.interfaces.nsIScriptableUnicodeConverter);
	        conv.charset = charset ? charset : "UTF-8";
	        return conv.ConvertToUnicode(text);
	    }
	    catch (exc)
	    {
	        return text;
	    }
	},
	// ************************************************************************************************
	
	// Get the cookies
	getStoredCookies: function(host, path)
	{
	    var cookies = new Array();
	    
	    // If the host is set
	    if(host)
	    {
	        var cookie            = null;
	        var cookieEnumeration = Components.classes["@mozilla.org/cookiemanager;1"].getService(Components.interfaces.nsICookieManager).enumerator;
	        var cookieHost        = null;
	        var cookiePath        = null;
	
	        // Loop through the cookies
	        while(cookieEnumeration.hasMoreElements())
	        {
	            cookie = cookieEnumeration.getNext().QueryInterface(Components.interfaces.nsICookie);
	
	            cookieHost = cookie.host;
	            cookiePath = cookie.path;
	
	            // If there is a host and path for this cookie
	            if(cookieHost && cookiePath)
	            {
	                // If the cookie host starts with '.'
	                if(cookieHost.charAt(0) == ".")
	                {
	                    cookieHost = cookieHost.substring(1);
	                }
	
	                // If the host and cookie host and path and cookie path match
	                //if((host == cookieHost || host.indexOf("." + cookieHost) != -1) && (path == cookiePath || path.indexOf(cookiePath) == 0))
	                if((host == cookieHost || host.indexOf("." + cookieHost) != -1) && (path == cookiePath || path.indexOf(cookiePath) == 0)) 
	                {
	                    cookies.push(cookie);
	                }
	            }
	        }
	    }
	
	    return cookies;
	},
	
	HttpFoxNsResultErrors: 
	{
		NS_ERROR_BASE: 0xC1F30000,
		NS_ERROR_NOT_IMPLEMENTED: 0x80004001,
		NS_ERROR_INVALID_POINTER: 0x80004003,
		NS_ERROR_ABORT: 0x80004004,
		NS_ERROR_FAILURE: 0x80004005,
		NS_ERROR_UNEXPECTED: 0x8000FFFF,
		NS_ERROR_PROXY_INVALID_IN_PARAMETER: 0x80010010,
		NS_ERROR_PROXY_INVALID_OUT_PARAMETER: 0x80010011,
		NS_ERROR_NO_AGGREGATION: 0x80040110,
		NS_ERROR_NOT_AVAILABLE: 0x80040111,
		NS_ERROR_FACTORY_NOT_REGISTERED: 0x80040154,
		NS_ERROR_FACTORY_REGISTER_AGAIN: 0x80040155,
		NS_ERROR_FACTORY_NOT_LOADED: 0x800401F8,
		NS_ERROR_OUT_OF_MEMORY: 0x8007000E,
		NS_ERROR_ILLEGAL_VALUE: 0x80070057,
		NS_ERROR_CANNOT_CONVERT_DATA: 0x80460001,
		NS_ERROR_OBJECT_IS_IMMUTABLE: 0x80460002,
		NS_ERROR_LOSS_OF_SIGNIFICANT_DATA: 0x80460003,
		NS_ERROR_SERVICE_NOT_AVAILABLE: 0x80460016,
		NS_ERROR_IS_DIR: 0x80460018,
		NS_ERROR_ILLEGAL_DURING_SHUTDOWN: 0x8046001E,
		NS_BASE_STREAM_CLOSED: 0x80470002,
		NS_BASE_STREAM_OSERROR: 0x80470003,
		NS_BASE_STREAM_ILLEGAL_ARGS: 0x80470004,
		NS_BASE_STREAM_NO_CONVERTER: 0x80470005,
		NS_BASE_STREAM_BAD_CONVERSION: 0x80470006,
		NS_BASE_STREAM_WOULD_BLOCK: 0x80470007,
		NS_ERROR_GFX_PRINTER_CMD_NOT_FOUND: 0x80480002,
		NS_ERROR_GFX_PRINTER_CMD_FAILURE: 0x80480003,
		NS_ERROR_GFX_PRINTER_NO_PRINTER_AVAILABLE: 0x80480004,
		NS_ERROR_GFX_PRINTER_NAME_NOT_FOUND: 0x80480005,
		NS_ERROR_GFX_PRINTER_ACCESS_DENIED: 0x80480006,
		NS_ERROR_GFX_PRINTER_INVALID_ATTRIBUTE: 0x80480007,
		NS_ERROR_GFX_PRINTER_PRINTER_NOT_READY: 0x80480009,
		NS_ERROR_GFX_PRINTER_OUT_OF_PAPER: 0x8048000A,
		NS_ERROR_GFX_PRINTER_PRINTER_IO_ERROR: 0x8048000B,
		NS_ERROR_GFX_PRINTER_COULD_NOT_OPEN_FILE: 0x8048000C,
		NS_ERROR_GFX_PRINTER_FILE_IO_ERROR: 0x8048000D,
		NS_ERROR_GFX_PRINTER_PRINTPREVIEW: 0x8048000E,
		NS_ERROR_GFX_PRINTER_STARTDOC: 0x8048000F,
		NS_ERROR_GFX_PRINTER_ENDDOC: 0x80480010,
		NS_ERROR_GFX_PRINTER_STARTPAGE: 0x80480011,
		NS_ERROR_GFX_PRINTER_ENDPAGE: 0x80480012,
		NS_ERROR_GFX_PRINTER_PRINT_WHILE_PREVIEW: 0x80480013,
		NS_ERROR_GFX_PRINTER_PAPER_SIZE_NOT_SUPPORTED: 0x80480014,
		NS_ERROR_GFX_PRINTER_ORIENTATION_NOT_SUPPORTED: 0x80480015,
		NS_ERROR_GFX_PRINTER_COLORSPACE_NOT_SUPPORTED: 0x80480016,
		NS_ERROR_GFX_PRINTER_TOO_MANY_COPIES: 0x80480017,
		NS_ERROR_GFX_PRINTER_DRIVER_CONFIGURATION_ERROR: 0x80480018,
		NS_ERROR_GFX_PRINTER_DOC_IS_BUSY_PP: 0x80480019,
		NS_ERROR_GFX_PRINTER_DOC_WAS_DESTORYED: 0x8048001A,
		NS_ERROR_GFX_PRINTER_NO_XUL: 0x8048001B,
		NS_ERROR_GFX_NO_PRINTDIALOG_IN_TOOLKIT: 0x8048001C,
		NS_ERROR_GFX_NO_PRINTROMPTSERVICE: 0x8048001D,
		NS_ERROR_GFX_PRINTER_PLEX_NOT_SUPPORTED: 0x8048001E,
		NS_ERROR_GFX_PRINTER_DOC_IS_BUSY: 0x8048001F,
		NS_ERROR_GFX_PRINTING_NOT_IMPLEMENTED: 0x80480020,
		NS_ERROR_GFX_COULD_NOT_LOAD_PRINT_MODULE: 0x80480021,
		NS_ERROR_GFX_PRINTER_RESOLUTION_NOT_SUPPORTED: 0x80480022,
		NS_BINDING_FAILED: 0x804B0001,
		NS_BINDING_ABORTED: 0x804B0002,
		NS_BINDING_REDIRECTED: 0x804B0003,
		NS_BINDING_RETARGETED: 0x804B0004,
		NS_ERROR_MALFORMED_URI: 0x804B000A,
		NS_ERROR_ALREADY_CONNECTED: 0x804B000B,
		NS_ERROR_NOT_CONNECTED: 0x804B000C,
		NS_ERROR_CONNECTION_REFUSED: 0x804B000D,
		NS_ERROR_NET_TIMEOUT: 0x804B000E,
		NS_ERROR_IN_PROGRESS: 0x804B000F,
		NS_ERROR_OFFLINE: 0x804B0010,
		NS_ERROR_NO_CONTENT: 0x804B0011,
		NS_ERROR_UNKNOWN_PROTOCOL: 0x804B0012,
		NS_ERROR_PORT_ACCESS_NOT_ALLOWED: 0x804B0013,
		NS_ERROR_NET_RESET: 0x804B0014,
		NS_ERROR_FTP_LOGIN: 0x804B0015,
		NS_ERROR_FTP_CWD: 0x804B0016,
		NS_ERROR_FTP_PASV: 0x804B0017,
		NS_ERROR_FTP_PWD: 0x804B0018,
		NS_ERROR_NOT_RESUMABLE: 0x804B0019,
		NS_ERROR_INVALID_CONTENT_ENCODING: 0x804B001B,
		NS_ERROR_FTP_LIST: 0x804B001C,
		NS_ERROR_UNKNOWN_HOST: 0x804B001E,
		NS_ERROR_REDIRECT_LOOP: 0x804B001F,
		NS_ERROR_ENTITY_CHANGED: 0x804B0020,
		NS_ERROR_UNKNOWN_PROXY_HOST: 0x804B002A,
		NS_ERROR_UNKNOWN_SOCKET_TYPE: 0x804B0033,
		NS_ERROR_SOCKET_CREATE_FAILED: 0x804B0034,
		NS_ERROR_CACHE_KEY_NOT_FOUND: 0x804B003D,
		NS_ERROR_CACHE_DATA_IS_STREAM: 0x804B003E,
		NS_ERROR_CACHE_DATA_IS_NOT_STREAM: 0x804B003F,
		NS_ERROR_CACHE_WAIT_FOR_VALIDATION: 0x804B0040,
		NS_ERROR_CACHE_ENTRY_DOOMED: 0x804B0041,
		NS_ERROR_CACHE_READ_ACCESS_DENIED: 0x804B0042,
		NS_ERROR_CACHE_WRITE_ACCESS_DENIED: 0x804B0043,
		NS_ERROR_CACHE_IN_USE: 0x804B0044,
		NS_ERROR_DOCUMENT_NOT_CACHED: 0x804B0046,
		NS_ERROR_NET_INTERRUPT: 0x804B0047,
		NS_ERROR_PROXY_CONNECTION_REFUSED: 0x804B0048,
		NS_ERROR_ALREADY_OPENED: 0x804B0049,
		NS_ERROR_UNSAFE_CONTENT_TYPE: 0x804B004A,
		NS_ERROR_INSUFFICIENT_DOMAIN_LEVELS: 0x804B0050,
		NS_ERROR_HOST_IS_IP_ADDRESS: 0x804B0051,
		NS_ERROR_PLUGINS_PLUGINSNOTCHANGED: 0x804C03E8,
		NS_ERROR_PLUGIN_DISABLED: 0x804C03E9,
		NS_ERROR_PLUGIN_BLOCKLISTED: 0x804C03EA,
		NS_ERROR_HTMLPARSER_EOF: 0x804E03E8,
		NS_ERROR_HTMLPARSER_UNKNOWN: 0x804E03E9,
		NS_ERROR_HTMLPARSER_CANTPROPAGATE: 0x804E03EA,
		NS_ERROR_HTMLPARSER_CONTEXTMISMATCH: 0x804E03EB,
		NS_ERROR_HTMLPARSER_BADFILENAME: 0x804E03EC,
		NS_ERROR_HTMLPARSER_BADURL: 0x804E03ED,
		NS_ERROR_HTMLPARSER_INVALIDPARSERCONTEXT: 0x804E03EE,
		NS_ERROR_HTMLPARSER_INTERRUPTED: 0x804E03EF,
		NS_ERROR_HTMLPARSER_BLOCK: 0x804E03F0,
		NS_ERROR_HTMLPARSER_BADTOKENIZER: 0x804E03F1,
		NS_ERROR_HTMLPARSER_BADATTRIBUTE: 0x804E03F2,
		NS_ERROR_HTMLPARSER_UNRESOLVEDDTD: 0x804E03F3,
		NS_ERROR_HTMLPARSER_MISPLACEDTABLECONTENT: 0x804E03F4,
		NS_ERROR_HTMLPARSER_BADDTD: 0x804E03F5,
		NS_ERROR_HTMLPARSER_BADCONTEXT: 0x804E03F6,
		NS_ERROR_HTMLPARSER_STOPPARSING: 0x804E03F7,
		NS_ERROR_HTMLPARSER_UNTERMINATEDSTRINGLITERAL: 0x804E03F8,
		NS_ERROR_HTMLPARSER_HIERARCHYTOODEEP: 0x804E03F9,
		NS_ERROR_HTMLPARSER_FAKE_ENDTAG: 0x804E03FA,
		NS_ERROR_HTMLPARSER_INVALID_COMMENT: 0x804E03FB,
		NS_ERROR_UCONV_NOCONV: 0x80500001,
		NS_ERROR_UDEC_ILLEGALINPUT: 0x8050000E,
		NS_ERROR_ILLEGAL_INPUT: 0x8050000E,
		NS_ERROR_REG_BADTYPE: 0x80510001,
		NS_ERROR_REG_BADTYPE: 0x80510001,
		NS_ERROR_REG_NOT_FOUND: 0x80510003,
		NS_ERROR_REG_NOT_FOUND: 0x80510003,
		NS_ERROR_REG_NOFILE: 0x80510004,
		NS_ERROR_REG_NOFILE: 0x80510004,
		NS_ERROR_REG_BUFFER_TOO_SMALL: 0x80510005,
		NS_ERROR_REG_BUFFER_TOO_SMALL: 0x80510005,
		NS_ERROR_REG_NAME_TOO_LONG: 0x80510006,
		NS_ERROR_REG_NAME_TOO_LONG: 0x80510006,
		NS_ERROR_REG_NO_PATH: 0x80510007,
		NS_ERROR_REG_NO_PATH: 0x80510007,
		NS_ERROR_REG_READ_ONLY: 0x80510008,
		NS_ERROR_REG_READ_ONLY: 0x80510008,
		NS_ERROR_REG_BAD_UTF8: 0x80510009,
		NS_ERROR_REG_BAD_UTF8: 0x80510009,
		NS_ERROR_FILE_UNRECOGNIZED_PATH: 0x80520001,
		NS_ERROR_FILE_UNRESOLVABLE_SYMLINK: 0x80520002,
		NS_ERROR_FILE_EXECUTION_FAILED: 0x80520003,
		NS_ERROR_FILE_UNKNOWN_TYPE: 0x80520004,
		NS_ERROR_FILE_DESTINATION_NOT_DIR: 0x80520005,
		NS_ERROR_FILE_TARGET_DOES_NOT_EXIST: 0x80520006,
		NS_ERROR_FILE_COPY_OR_MOVE_FAILED: 0x80520007,
		NS_ERROR_FILE_ALREADY_EXISTS: 0x80520008,
		NS_ERROR_FILE_INVALID_PATH: 0x80520009,
		NS_ERROR_FILE_DISK_FULL: 0x8052000A,
		NS_ERROR_FILE_CORRUPTED: 0x8052000B,
		NS_ERROR_FILE_NOT_DIRECTORY: 0x8052000C,
		NS_ERROR_FILE_IS_DIRECTORY: 0x8052000D,
		NS_ERROR_FILE_IS_LOCKED: 0x8052000E,
		NS_ERROR_FILE_TOO_BIG: 0x8052000F,
		NS_ERROR_FILE_NO_DEVICE_SPACE: 0x80520010,
		NS_ERROR_FILE_NAME_TOO_LONG: 0x80520011,
		NS_ERROR_FILE_NOT_FOUND: 0x80520012,
		NS_ERROR_FILE_READ_ONLY: 0x80520013,
		NS_ERROR_FILE_DIR_NOT_EMPTY: 0x80520014,
		NS_ERROR_FILE_ACCESS_DENIED: 0x80520015,
		NS_ERROR_DOM_INDEX_SIZE_ERR: 0x80530001,
		NS_ERROR_DOM_DOMSTRING_SIZE_ERR: 0x80530002,
		NS_ERROR_DOM_HIERARCHY_REQUEST_ERR: 0x80530003,
		NS_ERROR_DOM_WRONG_DOCUMENT_ERR: 0x80530004,
		NS_ERROR_DOM_INVALID_CHARACTER_ERR: 0x80530005,
		NS_ERROR_DOM_NO_DATA_ALLOWED_ERR: 0x80530006,
		NS_ERROR_DOM_NO_MODIFICATION_ALLOWED_ERR: 0x80530007,
		NS_ERROR_DOM_NOT_FOUND_ERR: 0x80530008,
		NS_ERROR_DOM_NOT_SUPPORTED_ERR: 0x80530009,
		NS_ERROR_DOM_INUSE_ATTRIBUTE_ERR: 0x8053000A,
		NS_ERROR_DOM_INVALID_STATE_ERR: 0x8053000B,
		NS_ERROR_DOM_SYNTAX_ERR: 0x8053000C,
		NS_ERROR_DOM_INVALID_MODIFICATION_ERR: 0x8053000D,
		NS_ERROR_DOM_NAMESPACE_ERR: 0x8053000E,
		NS_ERROR_DOM_INVALID_ACCESS_ERR: 0x8053000F,
		NS_ERROR_DOM_VALIDATION_ERR: 0x80530010,
		NS_ERROR_DOM_TYPE_MISMATCH_ERR: 0x80530011,
		NS_ERROR_DOM_SECURITY_ERR: 0x805303E8,
		NS_ERROR_DOM_SECMAN_ERR: 0x805303E9,
		NS_ERROR_DOM_WRONG_TYPE_ERR: 0x805303EA,
		NS_ERROR_DOM_NOT_OBJECT_ERR: 0x805303EB,
		NS_ERROR_DOM_NOT_XPC_OBJECT_ERR: 0x805303EC,
		NS_ERROR_DOM_NOT_NUMBER_ERR: 0x805303ED,
		NS_ERROR_DOM_NOT_BOOLEAN_ERR: 0x805303EE,
		NS_ERROR_DOM_NOT_FUNCTION_ERR: 0x805303EF,
		NS_ERROR_DOM_TOO_FEW_PARAMETERS_ERR: 0x805303F0,
		NS_ERROR_DOM_BAD_DOCUMENT_DOMAIN: 0x805303F1,
		NS_ERROR_DOM_PROP_ACCESS_DENIED: 0x805303F2,
		NS_ERROR_DOM_XPCONNECT_ACCESS_DENIED: 0x805303F3,
		NS_ERROR_DOM_BAD_URI: 0x805303F4,
		NS_ERROR_DOM_RETVAL_UNDEFINED: 0x805303F5,
		NS_ERROR_DOM_QUOTA_REACHED: 0x805303F6,
		NS_IMAGELIB_ERROR_FAILURE: 0x80540005,
		NS_IMAGELIB_ERROR_NO_DECODER: 0x80540006,
		NS_IMAGELIB_ERROR_NOT_FINISHED: 0x80540007,
		NS_IMAGELIB_ERROR_LOAD_ABORTED: 0x80540008,
		NS_IMAGELIB_ERROR_NO_ENCODER: 0x80540009,
		NS_ERROR_EDITOR_NO_SELECTION: 0x80560001,
		NS_ERROR_EDITOR_NO_TEXTNODE: 0x80560002,
		NS_FOUND_TARGET: 0x80560003,
		NS_ERROR_LAUNCHED_CHILD_PROCESS: 0x805800C8,
		NS_ERROR_LDAP_OPERATIONS_ERROR: 0x80590001,
		NS_ERROR_LDAP_PROTOCOL_ERROR: 0x80590002,
		NS_ERROR_LDAP_TIMELIMIT_EXCEEDED: 0x80590003,
		NS_ERROR_LDAP_SIZELIMIT_EXCEEDED: 0x80590004,
		NS_ERROR_LDAP_COMPARE_FALSE: 0x80590005,
		NS_ERROR_LDAP_COMPARE_TRUE: 0x80590006,
		NS_ERROR_LDAP_STRONG_AUTH_NOT_SUPPORTED: 0x80590007,
		NS_ERROR_LDAP_STRONG_AUTH_REQUIRED: 0x80590008,
		NS_ERROR_LDAP_PARTIAL_RESULTS: 0x80590009,
		NS_ERROR_LDAP_REFERRAL: 0x8059000A,
		NS_ERROR_LDAP_ADMINLIMIT_EXCEEDED: 0x8059000B,
		NS_ERROR_LDAP_UNAVAILABLE_CRITICAL_EXTENSION: 0x8059000C,
		NS_ERROR_LDAP_CONFIDENTIALITY_REQUIRED: 0x8059000D,
		NS_ERROR_LDAP_SASL_BIND_IN_PROGRESS: 0x8059000E,
		NS_ERROR_LDAP_NO_SUCH_ATTRIBUTE: 0x80590010,
		NS_ERROR_LDAP_UNDEFINED_TYPE: 0x80590011,
		NS_ERROR_LDAP_INAPPROPRIATE_MATCHING: 0x80590012,
		NS_ERROR_LDAP_CONSTRAINT_VIOLATION: 0x80590013,
		NS_ERROR_LDAP_TYPE_OR_VALUE_EXISTS: 0x80590014,
		NS_ERROR_LDAP_INVALID_SYNTAX: 0x80590015,
		NS_ERROR_LDAP_NO_SUCH_OBJECT: 0x80590020,
		NS_ERROR_LDAP_ALIAS_PROBLEM: 0x80590021,
		NS_ERROR_LDAP_INVALID_DN_SYNTAX: 0x80590022,
		NS_ERROR_LDAP_IS_LEAF: 0x80590023,
		NS_ERROR_LDAP_ALIAS_DEREF_PROBLEM: 0x80590024,
		NS_ERROR_LDAP_INAPPROPRIATE_AUTH: 0x80590030,
		NS_ERROR_LDAP_INVALID_CREDENTIALS: 0x80590031,
		NS_ERROR_LDAP_INSUFFICIENT_ACCESS: 0x80590032,
		NS_ERROR_LDAP_BUSY: 0x80590033,
		NS_ERROR_LDAP_UNAVAILABLE: 0x80590034,
		NS_ERROR_LDAP_UNWILLING_TO_PERFORM: 0x80590035,
		NS_ERROR_LDAP_LOOP_DETECT: 0x80590036,
		NS_ERROR_LDAP_SORT_CONTROL_MISSING: 0x8059003C,
		NS_ERROR_LDAP_INDEX_RANGE_ERROR: 0x8059003D,
		NS_ERROR_LDAP_NAMING_VIOLATION: 0x80590040,
		NS_ERROR_LDAP_OBJECT_CLASS_VIOLATION: 0x80590041,
		NS_ERROR_LDAP_NOT_ALLOWED_ON_NONLEAF: 0x80590042,
		NS_ERROR_LDAP_NOT_ALLOWED_ON_RDN: 0x80590043,
		NS_ERROR_LDAP_ALREADY_EXISTS: 0x80590044,
		NS_ERROR_LDAP_NO_OBJECT_CLASS_MODS: 0x80590045,
		NS_ERROR_LDAP_RESULTS_TOO_LARGE: 0x80590046,
		NS_ERROR_LDAP_AFFECTS_MULTIPLE_DSAS: 0x80590047,
		NS_ERROR_LDAP_OTHER: 0x80590050,
		NS_ERROR_LDAP_SERVER_DOWN: 0x80590051,
		NS_ERROR_LDAP_LOCAL_ERROR: 0x80590052,
		NS_ERROR_LDAP_ENCODING_ERROR: 0x80590053,
		NS_ERROR_LDAP_DECODING_ERROR: 0x80590054,
		NS_ERROR_LDAP_TIMEOUT: 0x80590055,
		NS_ERROR_LDAP_AUTH_UNKNOWN: 0x80590056,
		NS_ERROR_LDAP_FILTER_ERROR: 0x80590057,
		NS_ERROR_LDAP_USER_CANCELLED: 0x80590058,
		NS_ERROR_LDAP_PARAM_ERROR: 0x80590059,
		NS_ERROR_LDAP_NO_MEMORY: 0x8059005A,
		NS_ERROR_LDAP_CONNECT_ERROR: 0x8059005B,
		NS_ERROR_LDAP_NOT_SUPPORTED: 0x8059005C,
		NS_ERROR_LDAP_CONTROL_NOT_FOUND: 0x8059005D,
		NS_ERROR_LDAP_NO_RESULTS_RETURNED: 0x8059005E,
		NS_ERROR_LDAP_MORE_RESULTS_TO_RETURN: 0x8059005F,
		NS_ERROR_LDAP_CLIENT_LOOP: 0x80590060,
		NS_ERROR_LDAP_REFERRAL_LIMIT_EXCEEDED: 0x80590061,
		NS_ERROR_CMS_VERIFY_NOT_SIGNED: 0x805A0400,
		NS_ERROR_CMS_VERIFY_NO_CONTENT_INFO: 0x805A0401,
		NS_ERROR_CMS_VERIFY_BAD_DIGEST: 0x805A0402,
		NS_ERROR_CMS_VERIFY_NOCERT: 0x805A0404,
		NS_ERROR_CMS_VERIFY_UNTRUSTED: 0x805A0405,
		NS_ERROR_CMS_VERIFY_ERROR_UNVERIFIED: 0x805A0407,
		NS_ERROR_CMS_VERIFY_ERROR_PROCESSING: 0x805A0408,
		NS_ERROR_CMS_VERIFY_BAD_SIGNATURE: 0x805A0409,
		NS_ERROR_CMS_VERIFY_DIGEST_MISMATCH: 0x805A040A,
		NS_ERROR_CMS_VERIFY_UNKNOWN_ALGO: 0x805A040B,
		NS_ERROR_CMS_VERIFY_UNSUPPORTED_ALGO: 0x805A040C,
		NS_ERROR_CMS_VERIFY_MALFORMED_SIGNATURE: 0x805A040D,
		NS_ERROR_CMS_VERIFY_HEADER_MISMATCH: 0x805A040E,
		NS_ERROR_CMS_VERIFY_NOT_YET_ATTEMPTED: 0x805A040F,
		NS_ERROR_CMS_VERIFY_CERT_WITHOUT_ADDRESS: 0x805A0410,
		NS_ERROR_CMS_ENCRYPT_NO_BULK_ALG: 0x805A0420,
		NS_ERROR_CMS_ENCRYPT_INCOMPLETE: 0x805A0421,
		NS_ERROR_DOM_INVALID_EXPRESSION_ERR: 0x805B0033,
		NS_ERROR_DOM_TYPE_ERR: 0x805B0034,
		NS_ERROR_DOM_RANGE_BAD_BOUNDARYPOINTS_ERR: 0x805C0001,
		NS_ERROR_DOM_RANGE_INVALID_NODE_TYPE_ERR: 0x805C0002,
		NS_ERROR_WONT_HANDLE_CONTENT: 0x805D0001,
		NS_ERROR_MALWARE_URI: 0x805D001E,
		NS_ERROR_PHISHING_URI: 0x805D001F,
		NS_ERROR_IMAGE_SRC_CHANGED: 0x805E0008,
		NS_ERROR_IMAGE_BLOCKED: 0x805E0009,
		NS_ERROR_CONTENT_BLOCKED: 0x805E000A,
		NS_ERROR_CONTENT_BLOCKED_SHOW_ALT: 0x805E000B,
		NS_PROPTABLE_PROP_NOT_THERE: 0x805E000E,
		TM_ERROR: 0x80600001,
		NS_ERROR_XSLT_PARSE_FAILURE: 0x80600001,
		TM_ERROR_WRONG_QUEUE: 0x80600002,
		NS_ERROR_XPATH_PARSE_FAILURE: 0x80600002,
		TM_ERROR_NOT_POSTED: 0x80600003,
		NS_ERROR_XSLT_ALREADY_SET: 0x80600003,
		TM_ERROR_QUEUE_EXISTS: 0x80600004,
		NS_ERROR_XSLT_EXECUTION_FAILURE: 0x80600004,
		NS_ERROR_XPATH_UNKNOWN_FUNCTION: 0x80600005,
		TM_SUCCESS_DELETE_QUEUE: 0x80600006,
		NS_ERROR_XSLT_BAD_RECURSION: 0x80600006,
		NS_ERROR_XSLT_BAD_VALUE: 0x80600007,
		NS_ERROR_XSLT_NODESET_EXPECTED: 0x80600008,
		NS_ERROR_XSLT_ABORTED: 0x80600009,
		NS_ERROR_XSLT_NETWORK_ERROR: 0x8060000A,
		NS_ERROR_XSLT_WRONG_MIME_TYPE: 0x8060000B,
		NS_ERROR_XSLT_LOAD_RECURSION: 0x8060000C,
		NS_ERROR_XPATH_BAD_ARGUMENT_COUNT: 0x8060000D,
		NS_ERROR_XPATH_BAD_EXTENSION_FUNCTION: 0x8060000E,
		NS_ERROR_XPATH_PAREN_EXPECTED: 0x8060000F,
		NS_ERROR_XPATH_INVALID_AXIS: 0x80600010,
		NS_ERROR_XPATH_NO_NODE_TYPE_TEST: 0x80600011,
		NS_ERROR_XPATH_BRACKET_EXPECTED: 0x80600012,
		NS_ERROR_XPATH_INVALID_VAR_NAME: 0x80600013,
		NS_ERROR_XPATH_UNEXPECTED_END: 0x80600014,
		NS_ERROR_XPATH_OPERATOR_EXPECTED: 0x80600015,
		NS_ERROR_XPATH_UNCLOSED_LITERAL: 0x80600016,
		NS_ERROR_XPATH_BAD_COLON: 0x80600017,
		NS_ERROR_XPATH_BAD_BANG: 0x80600018,
		NS_ERROR_XPATH_ILLEGAL_CHAR: 0x80600019,
		NS_ERROR_XPATH_BINARY_EXPECTED: 0x8060001A,
		NS_ERROR_XSLT_LOAD_BLOCKED_ERROR: 0x8060001B,
		NS_ERROR_XPATH_INVALID_EXPRESSION_EVALUATED: 0x8060001C,
		NS_ERROR_XPATH_UNBALANCED_CURLY_BRACE: 0x8060001D,
		NS_ERROR_XSLT_BAD_NODE_NAME: 0x8060001E,
		NS_ERROR_XSLT_VAR_ALREADY_SET: 0x8060001F,
		NS_ERROR_DOM_SVG_WRONG_TYPE_ERR: 0x80620000,
		NS_ERROR_DOM_SVG_INVALID_VALUE_ERR: 0x80620001,
		NS_ERROR_DOM_SVG_MATRIX_NOT_INVERTABLE: 0x80620002,
		MOZ_ERROR_STORAGE_ERROR: 0x80630001,
		NS_ERROR_SCHEMAVALIDATOR_NO_SCHEMA_LOADED: 0x80640001,
		NS_ERROR_SCHEMAVALIDATOR_NO_DOM_NODE_SPECIFIED: 0x80640002,
		NS_ERROR_SCHEMAVALIDATOR_NO_TYPE_FOUND: 0x80640003,
		NS_ERROR_SCHEMAVALIDATOR_TYPE_NOT_FOUND: 0x80640004,
		NS_ERROR_DOM_FILE_NOT_FOUND_ERR: 0x80650000,
		NS_ERROR_DOM_FILE_NOT_READABLE_ERR: 0x80650001,
		NS_ERROR_WSDL_NOT_WSDL_ELEMENT: 0x80780001,
		NS_ERROR_SCHEMA_NOT_SCHEMA_ELEMENT: 0x80780001,
		NS_ERROR_SCHEMA_NOT_SCHEMA_ELEMENT: 0x80780001,
		NS_ERROR_DOWNLOAD_COMPLETE: 0x80780001,
		NS_ERROR_WSDL_SCHEMA_PROCESSING_ERROR: 0x80780002,
		NS_ERROR_SCHEMA_UNKNOWN_TARGET_NAMESPACE: 0x80780002,
		NS_ERROR_SCHEMA_UNKNOWN_TARGET_NAMESPACE: 0x80780002,
		NS_ERROR_DOWNLOAD_NOT_PARTIAL: 0x80780002,
		NS_ERROR_WSDL_BINDING_NOT_FOUND: 0x80780003,
		NS_ERROR_SCHEMA_UNKNOWN_TYPE: 0x80780003,
		NS_ERROR_SCHEMA_UNKNOWN_TYPE: 0x80780003,
		NS_ERROR_WSDL_UNKNOWN_SCHEMA_COMPONENT: 0x80780004,
		NS_ERROR_SCHEMA_UNKNOWN_PREFIX: 0x80780004,
		NS_ERROR_SCHEMA_UNKNOWN_PREFIX: 0x80780004,
		NS_ERROR_WSDL_UNKNOWN_WSDL_COMPONENT: 0x80780005,
		NS_ERROR_SCHEMA_INVALID_STRUCTURE: 0x80780005,
		NS_ERROR_SCHEMA_INVALID_STRUCTURE: 0x80780005,
		NS_ERROR_WSDL_LOADING_ERROR: 0x80780006,
		NS_ERROR_SCHEMA_INVALID_TYPE_USAGE: 0x80780006,
		NS_ERROR_SCHEMA_INVALID_TYPE_USAGE: 0x80780006,
		NS_ERROR_WSDL_RECURSIVE_IMPORT: 0x80780007,
		NS_ERROR_SCHEMA_MISSING_TYPE: 0x80780007,
		NS_ERROR_SCHEMA_MISSING_TYPE: 0x80780007,
		NS_ERROR_WSDL_NOT_ENABLED: 0x80780008,
		NS_ERROR_SCHEMA_FACET_VALUE_ERROR: 0x80780008,
		NS_ERROR_SCHEMA_FACET_VALUE_ERROR: 0x80780008,
		NS_ERROR_SCHEMA_LOADING_ERROR: 0x80780009,
		NS_ERROR_SCHEMA_LOADING_ERROR: 0x80780009,
		IPC_WAIT_NEXT_MESSAGE: 0x8078000A,
		NS_ERROR_UNORM_MOREOUTPUT: 0x80780021,
		NS_ERROR_WEBSHELL_REQUEST_REJECTED: 0x807803E9,
		NS_ERROR_DOCUMENT_IS_PRINTMODE: 0x807807D1,
		NS_ERROR_XFORMS_CALCUATION_EXCEPTION: 0x80780BB9,
		NS_ERROR_XFORMS_CALCULATION_EXCEPTION: 0x80780BB9,
		NS_ERROR_XFORMS_UNION_TYPE: 0x80780BBA
	}
}

/***********************************************************
module definition (xpcom registration)
***********************************************************/
var HttpFoxServiceModule = 
{
	registerSelf: function(aCompMgr, aFileSpec, aLocation, aType)
	{
		aCompMgr = aCompMgr.
			QueryInterface(Components.interfaces.nsIComponentRegistrar);
		aCompMgr.registerFactoryLocation(CLASS_ID, CLASS_NAME, 
			CONTRACT_ID, aFileSpec, aLocation, aType);
	},

	unregisterSelf: function(aCompMgr, aLocation, aType)
	{
		aCompMgr = aCompMgr.
			QueryInterface(Components.interfaces.nsIComponentRegistrar);
		aCompMgr.unregisterFactoryLocation(CLASS_ID, aLocation);        
	},

	getClassObject: function(aCompMgr, aCID, aIID)
	{
		if (!aIID.equals(Components.interfaces.nsIFactory))
			throw Components.results.NS_ERROR_NOT_IMPLEMENTED;

		if (aCID.equals(CLASS_ID))
			return this.HttpFoxServiceFactory;

		throw Components.results.NS_ERROR_NO_INTERFACE;
	},

	canUnload: function(aCompMgr) 
	{ 
		return true;
	},
	
	/***********************************************************
	class factory

	This object is a member of the global-scope Components.classes.
	It is keyed off of the contract ID. Eg:

	myHelloWorld = Components.classes["@dietrich.ganx4.com/helloworld;1"].
                          createInstance(Components.interfaces.nsIHelloWorld);

	***********************************************************/
	HttpFoxServiceFactory:
	{
		createInstance: function(aOuter, aIID)
		{
			if (aOuter != null)
				throw Components.results.NS_ERROR_NO_AGGREGATION;
				
			return (new HttpFoxService()).QueryInterface(aIID);
		}
	}
};

// FF 2
/***********************************************************
module initialization

When the application registers the component, this function
is called.
***********************************************************/
function NSGetModule(aCompMgr, aFileSpec) 
{
	return HttpFoxServiceModule;
}

// FF 4+
if (typeof XPCOMUtils != "undefined")
{
	if (XPCOMUtils.generateNSGetFactory) {
		// FF 4+
		var NSGetFactory = XPCOMUtils.generateNSGetFactory([HttpFoxService]);	
	}
}
//**************************************************************************************************************
// AMF0 and AMF3 parsing functions

BinaryParser = function(bigEndian, allowExceptions){
    this.bigEndian = bigEndian, this.allowExceptions = allowExceptions;
};
with({p: BinaryParser.prototype}){
    p.encodeFloat = function(number, precisionBits, exponentBits){
        var bias = Math.pow(2, exponentBits - 1) - 1, minExp = -bias + 1, maxExp = bias, minUnnormExp = minExp - precisionBits,
        status = isNaN(n = parseFloat(number)) || n == -Infinity || n == +Infinity ? n : 0,
        exp = 0, len = 2 * bias + 1 + precisionBits + 3, bin = new Array(len),
        signal = (n = status !== 0 ? 0 : n) < 0, n = Math.abs(n), intPart = Math.floor(n), floatPart = n - intPart,
        i, lastBit, rounded, j, result;
        for(i = len; i; bin[--i] = 0);
        for(i = bias + 2; intPart && i; bin[--i] = intPart % 2, intPart = Math.floor(intPart / 2));
        for(i = bias + 1; floatPart > 0 && i; (bin[++i] = ((floatPart *= 2) >= 1) - 0) && --floatPart);
        for(i = -1; ++i < len && !bin[i];);
        if(bin[(lastBit = precisionBits - 1 + (i = (exp = bias + 1 - i) >= minExp && exp <= maxExp ? i + 1 : bias + 1 - (exp = minExp - 1))) + 1]){
            if(!(rounded = bin[lastBit]))
                for(j = lastBit + 2; !rounded && j < len; rounded = bin[j++]);
            for(j = lastBit + 1; rounded && --j >= 0; (bin[j] = !bin[j] - 0) && (rounded = 0));
        }
        for(i = i - 2 < 0 ? -1 : i - 3; ++i < len && !bin[i];);

        (exp = bias + 1 - i) >= minExp && exp <= maxExp ? ++i : exp < minExp &&
            (exp != bias + 1 - len && exp < minUnnormExp && this.warn("encodeFloat::float underflow"), i = bias + 1 - (exp = minExp - 1));
        (intPart || status !== 0) && (this.warn(intPart ? "encodeFloat::float overflow" : "encodeFloat::" + status),
            exp = maxExp + 1, i = bias + 2, status == -Infinity ? signal = 1 : isNaN(status) && (bin[i] = 1));
        for(n = Math.abs(exp + bias), j = exponentBits + 1, result = ""; --j; result = (n % 2) + result, n = n >>= 1);
        for(n = 0, j = 0, i = (result = (signal ? "1" : "0") + result + bin.slice(i, i + precisionBits).join("")).length, r = [];
            i; n += (1 << j) * result.charAt(--i), j == 7 && (r[r.length] = String.fromCharCode(n), n = 0), j = (j + 1) % 8);
        r[r.length] = n ? String.fromCharCode(n) : "";
        return (this.bigEndian ? r.reverse() : r).join("");
    };
    p.encodeInt = function(number, bits, signed){
        var max = Math.pow(2, bits), r = [];
        (number >= max || number < -(max >> 1)) && this.warn("encodeInt::overflow") && (number = 0);
        number < 0 && (number += max);
        for(; number; r[r.length] = String.fromCharCode(number % 256), number = Math.floor(number / 256));
        for(bits = -(-bits >> 3) - r.length; bits--; r[r.length] = "\0");
        return (this.bigEndian ? r.reverse() : r).join("");
    };
    p.decodeFloat = function(data, precisionBits, exponentBits){
        var b = ((b = new this.Buffer(this.bigEndian, data)).checkBuffer(precisionBits + exponentBits + 1), b),
            bias = Math.pow(2, exponentBits - 1) - 1, signal = b.readBits(precisionBits + exponentBits, 1),
            exponent = b.readBits(precisionBits, exponentBits), significand = 0,
            divisor = 2, curByte = b.buffer.length + (-precisionBits >> 3) - 1,
            byteValue, startBit, mask;
        do
            for(byteValue = b.buffer[ ++curByte ], startBit = precisionBits % 8 || 8, mask = 1 << startBit;
                mask >>= 1; (byteValue & mask) && (significand += 1 / divisor), divisor *= 2);
        while(precisionBits -= startBit);
        return exponent == (bias << 1) + 1 ? significand ? NaN : signal ? -Infinity : +Infinity
            : (1 + signal * -2) * (exponent || significand ? !exponent ? Math.pow(2, -bias + 1) * significand
            : Math.pow(2, exponent - bias) * (1 + significand) : 0);
    };
    p.decodeInt = function(data, bits, signed){
        var b = new this.Buffer(this.bigEndian, data), x = b.readBits(0, bits), max = Math.pow(2, bits);
        return signed && x >= max / 2 ? x - max : x;
    };
    with({p: (p.Buffer = function(bigEndian, buffer){
        this.bigEndian = bigEndian || 0, this.buffer = [], this.setBuffer(buffer);
    }).prototype}){
        p.readBits = function(start, length){
            //shl fix: Henri Torgemane ~1996 (compressed by Jonas Raoni)
            function shl(a, b){
                for(++b; --b; a = ((a %= 0x7fffffff + 1) & 0x40000000) == 0x40000000 ? a * 2 : (a - 0x40000000) * 2 + 0x7fffffff + 1);
                return a;
            }
            if(start < 0 || length <= 0)
                return 0;
            this.checkBuffer(start + length);
            for(var offsetLeft, offsetRight = start % 8, curByte = this.buffer.length - (start >> 3) - 1,
                lastByte = this.buffer.length + (-(start + length) >> 3), diff = curByte - lastByte,
                sum = ((this.buffer[ curByte ] >> offsetRight) & ((1 << (diff ? 8 - offsetRight : length)) - 1))
                + (diff && (offsetLeft = (start + length) % 8) ? (this.buffer[ lastByte++ ] & ((1 << offsetLeft) - 1))
                << (diff-- << 3) - offsetRight : 0); diff; sum += shl(this.buffer[ lastByte++ ], (diff-- << 3) - offsetRight)
            );
            return sum;
        };
        p.setBuffer = function(data){
            if(data){
                for(var l, i = l = data.length, b = this.buffer = new Array(l); i; b[l - i] = data.charCodeAt(--i));
                this.bigEndian && b.reverse();
            }
        };
        p.hasNeededBits = function(neededBits){
            return this.buffer.length >= -(-neededBits >> 3);
        };
        p.checkBuffer = function(neededBits){
            if(!this.hasNeededBits(neededBits))
                throw new Error("checkBuffer::missing bytes");
        };
    }
    p.warn = function(msg){
        if(this.allowExceptions)
            throw new Error(msg);
        return 1;
    };
    p.toSmall = function(data){return this.decodeInt(data, 8, true);};
    p.fromSmall = function(number){return this.encodeInt(number, 8, true);};
    p.toByte = function(data){return this.decodeInt(data, 8, false);};
    p.fromByte = function(number){return this.encodeInt(number, 8, false);};
    p.toShort = function(data){return this.decodeInt(data, 16, true);};
    p.fromShort = function(number){return this.encodeInt(number, 16, true);};
    p.toWord = function(data){return this.decodeInt(data, 16, false);};
    p.fromWord = function(number){return this.encodeInt(number, 16, false);};
    p.toInt = function(data){return this.decodeInt(data, 32, true);};
    p.fromInt = function(number){return this.encodeInt(number, 32, true);};
    p.toDWord = function(data){return this.decodeInt(data, 32, false);};
    p.fromDWord = function(number){return this.encodeInt(number, 32, false);};
    p.toFloat = function(data){return this.decodeFloat(data, 23, 8);};
    p.fromFloat = function(number){return this.encodeFloat(number, 23, 8);};
    p.toDouble = function(data){return this.decodeFloat(data, 52, 11);};
    p.fromDouble = function(number){return this.encodeFloat(number, 52, 11);};
}

function AmfParser()
{
    this.binaryParser = new BinaryParser(false, true);
}
AmfParser.prototype =
{
    StringData: null,
    currentPos: 0,
    stringLength: 0,
    binaryParser: null,
	isAMF: false,
	hasError: false,
	errorPos: 0,
	errorType: null,
	errorStack: null,

    // reference block
	// for AMF0
    AMF0ObjectRefTable: null,
    maxAMF0ObjIndex: undefined,
	// for AMF3
	ObjectRefTable: null,
    maxObjIndex: undefined,
	StringRefTable: null,
    maxStrIndex: undefined,
	TraitRefTable: null,
    maxTraitIndex: undefined,
    
    // fixed
	parseContent: function(content) {
		var res;
		var error_log;
		var i;
		
		this.StringData = content;
		this.currentPos = 0;
		this.stringLength = content.length;
		this.isAMF = false;
		this.hasError = false;
		this.errorPos = 0;
		this.errorStack = [];
		res = this.unpackAMF0Packet(1);
        if ((res !== undefined) && (this.currentPos == this.stringLength)) {
			return 'AMF0 content' + res;
		}
		else if (this.hasError == true) {
			error_log = this.StringData.charAt(this.errorPos);
			for (i = 1; i <= 3; i++) {
				if (this.errorPos - i > 0) {
					error_log = this.StringData.charAt(this.errorPos - i) + error_log;
				}
				if (this.errorPos + i < this.stringLength) {
					error_log = error_log + this.StringData.charAt(this.errorPos + i);
				}
			}
			error_log = 'AMF0. Error encountered in this fragment: !' + error_log + '! At pos=' + this.errorPos + '\nErrorStack:\n'; 
			for (i = 0; i < this.errorStack.length; i++) {
				error_log += this.errorStack[i] + '\n';
			}
			return error_log + this.StringData;
		}
		
        this.currentPos = 0;
		this.StringRefTable = [];
		this.maxStrIndex = undefined;
		this.ObjectRefTable = [];
		this.maxObjIndex = undefined;
		this.TraitRefTable = [];
		this.maxTraitIndex = undefined;
		this.isAMF = false;
		this.hasError = false;
		this.errorPos = 0;
		this.errorStack = [];
		res = this.unpackAMF3Data(1);
		if ((res !== undefined) && (this.currentPos == this.stringLength)) {
            return 'AMF3 content\n' + res;
		}
		else if (this.hasError == true) {
			error_log = this.StringData.charAt(this.errorPos);
			for (i = 1; i <= 3; i++) {
				if (this.errorPos - i > 0) {
					error_log = this.StringData.charAt(this.errorPos - i) + error_log;
				}
				if (this.errorPos + i < this.stringLength) {
					error_log = error_log + this.StringData.charAt(this.errorPos + i);
				}
			}
			error_log = 'AMF3. Error encountered in this fragment: !' + error_log + '! At pos=' + this.errorPos + '\nErrorStack:\n'; 
			for (i = 0; i < this.errorStack.length; i++) {
				error_log += this.errorStack[i] + '\n';
			}
			return error_log + this.StringData;
		}
		return undefined;
	},
    
    //+ 
    unpackAMF0Packet: function(tabLevel) {
        if (this.stringLength <= 0) {
            //console.log("[Amf::amfUnpackData] String is too short");
            return undefined;
        }
        var res = '\n';
		var tempres;
		var i;
		// determining the amf version;
        if ((this.stringLength - this.currentPos) < 2) {
			return undefined;
		}
        var version = this.getIntegerFromCurrentPos(2);
        if (version != 0 && version != 3) {
            return undefined;
        }
		else {
			this.isAMF = true;
			res += 'AMF version: ' + version + '\n';
		}
        // counting the number of headers
        if ((this.stringLength - this.currentPos) < 2) {
			return undefined;
		}		
        var headerCount = this.getIntegerFromCurrentPos(2);
		for (i = 0; i < headerCount; i++) {
			this.StringRefTable = [];
			this.maxStrIndex = undefined;
			this.AMF0ObjectRefTable = [];
			this.maxAMF0ObjIndex = undefined;
			this.ObjectRefTable = [];
			this.maxObjIndex = undefined;
			this.TraitRefTable = [];
			this.maxTraitIndex = undefined;
			res += 'Header: ' + i + '\n';
			tempres = this.decodeAMF0UTF8Str(false, true);
			if (tempres === undefined) {
				return undefined;
			}
			res += '\tName: ' + tempres + '\n';
            if ((this.stringLength - this.currentPos) < 1) {
                return undefined;
            }		
			tempres = this.getIntegerFromCurrentPos(1);
			//if (tempres != 0)	// must-understand failed
			//	return undefined;
			res += '\tMust-understand: ' + tempres + '\n';
            if ((this.stringLength - this.currentPos) < 4) {
                return undefined;
            }		
			tempres = this.getIntegerFromCurrentPos(4);
			res += '\tByte length: ' + tempres + '\n';
			tempres = this.unpackAMF0Data(tabLevel + 1);
			if (tempres === undefined) {
				return undefined;
			}
			res += '\tData: ' + tempres + '\n';
		}
		// counting the number of messages
        if ((this.stringLength - this.currentPos) < 2) {
			return undefined;
		}		
		var messageCount = this.getIntegerFromCurrentPos(2);
		for (i = 0; i < messageCount; i++) {
			this.StringRefTable = [];
			this.maxStrIndex = undefined;
			this.AMF0ObjectRefTable = [];
			this.maxAMF0ObjIndex = undefined;
			this.ObjectRefTable = [];
			this.maxObjIndex = undefined;
			this.TraitRefTable = [];
			this.maxTraitIndex = undefined;
			res += 'Message: ' + i + '\n';
			tempres = this.decodeAMF0UTF8Str(false, true);
			if (tempres === undefined) {
				return undefined;
			}
			res += '\tTarget URI: ' + tempres + '\n';
			tempres = this.decodeAMF0UTF8Str(false, true);
			if (tempres === undefined) {
				return undefined;
			}
			res += '\tResponse URI: ' + tempres + '\n';
            if ((this.stringLength - this.currentPos) < 4) {
                return undefined;
            }		
			tempres = this.getIntegerFromCurrentPos(4);
			res += '\tByte length: ' + tempres + '\n';
			tempres = this.unpackAMF0Data(tabLevel + 1);
			if (tempres === undefined) {
				return undefined;
			}
			res += '\tData: ' + tempres + '\n';
		}
		return res;
	},

    //+
    getIntegerFromCurrentPos: function(nChars) {
        var res = 0;
        
        for (var i = 0; i < nChars; i++) {
            res <<= 8;
            res |= this.binaryParser.decodeInt(this.StringData.charAt(this.currentPos), 8, false);
            this.currentPos++;
        }
        return res;
    },
    
	//+
    unpackAMF0Data: function(tabLevel) {	// if tabLevel == 2 than it is root level. Affects tabulateAMF0Data function
		var res;
		if ((this.stringLength - this.currentPos) < 1) {
			return undefined;
		}		
		var type = this.getIntegerFromCurrentPos(1);
		
		switch (type) {
            case 0x00:               //AMF0_NUMBER_MARKER
                res = this.decodeDoubleValue();
				if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack0DecodeDoubleErr");
					return undefined;
				}
                break;
            case 0x01:               // AMF0_BOOLEAN_MARKER
				if ((this.stringLength - this.currentPos) < 1) {
					return undefined;
				}
                res = this.getIntegerFromCurrentPos(1);
				if (res == 0) {
					res = false;
				}
				else {
					res = true;	
				}
                break;
            case 0x02:               //  AMF0_STRING_MARKER
                res = this.decodeAMF0UTF8Str(false, true);
				if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack0DecodeStrErr");
					return undefined;
				}
                break;
            case 0x03:               //    AMF0_OBJECT_MARKER
                res = this.decodeAMF0Object(tabLevel);
				if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack0DecodeObjectErr");
					return undefined;
				}
				res = this.tabulateAMF0Data(res, tabLevel);
                break;
            case 0x04:               //  AMF0_MOVIECLIP_MARKER
                // type is not supported and reserved for future use
				return undefined;
                break;
            case 0x05:              //  AMF0_NULL_MARKER
                res = null;			// check
                break;
            case 0x06:              //  AMF0_UNDEFINED_MARKER
                res = 'undefined';
                break;
			case 0x07:				//  AMF0_REFERENCE_MARKER
				res = this.getAMF0ReferencedObject();
				if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack0DecodeRefObjectErr");
					return undefined;
				}
				res = this.tabulateAMF0Data(res, tabLevel);
				break;
            case 0x08:              //  AMF0_ECMA_ARRAY_MARKER
                res = this.decodeAMF0ECMAArray(tabLevel);
				if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack0DecodeECMAErr");
					return undefined;
				}
				res = this.tabulateAMF0Data(res, tabLevel);
				break;    
            case 0x09:              //  AMF0_OBJECT_END_MARKER
                return undefined;
				break; 
			case 0x0A:				// AMF0_STRICT_ARRAY_MARKER
				res = this.decodeAMF0StrictArray(tabLevel);
				if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack0DecodeStrictArrErr");
					return undefined;
				}
				res = this.tabulateAMF0Data(res, tabLevel);
				break;
			case 0x0B:				// AMF0_DATE_MARKER
				res = this.decodeAMF0Date();
				if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack0DecodeDateErr");
					return undefined;
				}
				break;
            case 0x0C:       		//  AMF0_LONG_STRING_MARKER
                res = this.decodeAMF0UTF8Str(false, false);
				if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack0DecodeLongStrErr");
					return undefined;
				}
				break;    
			case 0x0D:				//  AMF0_UNSUPPORTED_MARKER
				res = "\'Unsupported type\'";
				break;
			case 0x0E:				//  AMF0_RECORD_SET_MARKER
				// type is not supported
				return undefined;
				break;
			case 0x0F:				//  AMF0_XML_DOCUMENT_MARKER
				res = this.decodeAMF0UTF8Str(false, false);
				if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack0DecodeXMLDocErr");
					return undefined;
				}
				break;
			case 0x10:				//  AMF0_TYPED_OBJECT_MARKER
				res = this.decodeAMF0TypedObject(tabLevel);
				if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack0DecodeTypedObjectErr");
					return undefined;
				}
				res = this.tabulateAMF0Data(res, tabLevel);
				break;
			case 0x11:				// AMF0_AVM+_MARKER
				res = this.unpackAMF3Data(tabLevel);
				if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack0DecodeAMF3DataErr");
					return undefined;
				}
				break;
            default:
				//this.hasError = true;
				//this.errorPos = this.currentPos;
				this.errorStack.push("Unpack0WrongMarkerTypeErr");
                //console.log("[Amf::amfUnpackData] Unrecognized data type");
                return undefined;
        }
        return res;
	},
	//+ error check+
	decodeAMF0UTF8Str: function(isKey, isShort) {
		var res = '';
		var strlen;
		
		if (isShort) {
			if (this.stringLength - this.currentPos < 2) {
				this.hasError = true;
				this.errorPos = this.currentPos;
				this.errorStack.push("Str0LenShortOutOfBoundErr");
				return undefined;
			}
			strlen = this.getIntegerFromCurrentPos(2);
		}
		else {
			if (this.stringLength - this.currentPos < 4) {
				this.hasError = true;
				this.errorPos = this.currentPos;
				this.errorStack.push("Str0LenLongOutOfBoundErr");
				return undefined;
			}
			strlen = this.getIntegerFromCurrentPos(4);
		}
		
		if (strlen == 0) {
			;					// return null; was
		}
		else if (strlen < 0) {
			this.hasError = true;
			this.errorPos = this.currentPos;
			this.errorStack.push("Str0LenNegativeErr");
			return undefined;
		}
		else {
			if (this.currentPos + strlen > this.stringLength) {
				this.hasError = true;
				this.errorPos = this.currentPos;
				this.errorStack.push("Str0LenOutOfBoundErr");
				return undefined;
			}
		
			var charCode;
			var tmp;
			var k;
			var j = this.currentPos;
			while (j < this.currentPos + strlen) {		// converting from UTF-8 to Unicode
				charCode = this.binaryParser.decodeInt(this.StringData.charAt(j++), 8, false);
				if (charCode & 0x80) {			// more than one byte per UTF-8 symbol
					if ((charCode & 0xE0) == 0xC0) {		// two bytes per UTF-8 symbol
						charCode &= 0x1F;
						charCode <<= 6;
						k = 1;
					}
					else if ((charCode & 0xF0) == 0xE0) {	// three bytes per UTF-8 symbol
						charCode &= 0xF;
						charCode <<= 12;
						k = 2;
					}
					else if ((charCode & 0xF8) == 0xF0) {	// four byter per UTF-8 symbol
						charCode &= 0x7;
						charCode <<= 18;
						k = 3;
					}
					while (k > 0) {
						tmp = this.binaryParser.decodeInt(this.StringData.charAt(j++), 8, false);
						tmp &= 0x3F;
						charCode |= tmp << (--k * 6);
					}
				}    
				res += String.fromCharCode(charCode);
			}
			this.currentPos += strlen;
		}
		
		if (isKey == true)
			res = "'" + res + "'";
		else
			res = '\u0022' + res + '\u0022';	// \u0022 = "
		return res;
	},
    
	//+ 
	decodeAMF0Date: function() {
        var res;
		var tmp = this.decodeDoubleValue();
		if (tmp === undefined) {
			//console.log("[Amf::amfDecodeData] Can't decode date");
			return undefined;
		}
		res = new Date(tmp);
		if ((this.stringLength - this.currentPos) < 2) {
			return undefined;
		}
		tmp = this.getIntegerFromCurrentPos(2);	// we should read but they are reserved
		//if (tmp != 0)		// reserved
		//	res += ' TIMEZONE ' + tmp;
        return res;
    },
	
	//+ error check+
    decodeAMF0StrictArray: function(tabLevel) {
		var strlen;
		var res = [];
		var	tempres;
		var index;
		
		if ((this.stringLength - this.currentPos) < 4) {
			this.hasError = true;
			this.errorPos = this.currentPos;
			this.errorStack.push("StrictArr0PfxOutOfBoundErr");
			return undefined;
		}
		strlen = this.getIntegerFromCurrentPos(4);
		
		index = this.putAMF0ObjByRef(res);
		res.push('strict');		// defines strict array type
		res.push(undefined);
		for (var i = 0; i < strlen; i++) {
			tempres = this.unpackAMF0Data(tabLevel + 1);
			if (tempres === undefined) {
				this.hasError = true;
				this.errorPos = this.currentPos;
				this.errorStack.push("StrictArr0UnableToParseDataErr");
				return undefined;
			}
			res.push(tempres); 
		}
		this.putAMF0ObjByRef(res, index);
		
		return res;
	},
	
	//+ contains possible BUG	error check+
    decodeAMF0ObjectProperty: function(limit, tabLevel) {
		var res = [];
		var key;
		var value;
		var tmp;
		var i = 0;
		
		while (i <= limit || limit == -1) {		// if would be problems in parsing try to change <= to <
			key = this.decodeAMF0UTF8Str(true, true);
			if (key === undefined) {
				this.hasError = true;
				this.errorPos = this.currentPos;
				this.errorStack.push("ObjProp0KeyUnableToParseStrErr");
				return undefined;
			}
			if (key.length <= 2) {	// means null str
				if ((this.stringLength - this.currentPos) < 1) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("ObjProp0UnableToReadEndingByteErr");
					return undefined;
				}
				tmp = this.getIntegerFromCurrentPos(1);
				if (tmp == 0x09) {
					return res;
				}
				else {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("ObjProp0WrongEndingByteValueErr");
					return undefined;
				}
			}
			value = this.unpackAMF0Data(tabLevel + 1);
			if (value === undefined) {
				this.hasError = true;
				this.errorPos = this.currentPos;
				this.errorStack.push("ObjProp0ValUnableToParseDataErr");
				return undefined;
			}
			res.push(key);
			res.push(value);
			i++;
		}
		return res;
	},
	
	//+ error check+
    decodeAMF0Object: function(tabLevel) {
		var res;
		var index;
		
		index = this.putAMF0ObjByRef(res);
		res = this.decodeAMF0ObjectProperty(-1, tabLevel);
		if (res === undefined) {
			this.hasError = true;
			this.errorPos = this.currentPos;
			this.errorStack.push("Object0UnableToParseObjectPropErr");
			return undefined;
		}
		res.push('object');
		res.push('undefined');
		this.putAMF0ObjByRef(res, index);
		return res;
	},
	
	//+ error check+
    decodeAMF0ECMAArray: function(tabLevel) {
		var res;
		var index;
		var strlen;
		
		if ((this.stringLength - this.currentPos) < 4) {
			this.hasError = true;
			this.errorPos = this.currentPos;
			this.errorStack.push("ECMA0PfxOutOfBoundsErr");
			return undefined;
		}
		strlen = this.getIntegerFromCurrentPos(4);
        
		index = this.putAMF0ObjByRef(res);
		res = this.decodeAMF0ObjectProperty(strlen, tabLevel);
		if (res === undefined) {
			this.hasError = true;
			this.errorPos = this.currentPos;
			this.errorStack.push("ECMA0UnableToDecodeObjPropErr");
			return undefined;
		}
		res.push('ecma');
		res.push('undefined');
		this.putAMF0ObjByRef(res, index);
		
        return res;
	},
	
	//+ 
    decodeAMF0TypedObject: function(tabLevel) {
		var res;
		var className;
		var index;
		
		index = this.putAMF0ObjByRef(res);
		className = this.decodeAMF0UTF8Str(false, true);
		if (className === undefined) {
			return undefined;
		}
		res = this.decodeAMF0ObjectProperty(-1, tabLevel);
		if (res === undefined) {
			return undefined;
		}
		res.push('typed object');
		res.push(className);
		this.putAMF0ObjByRef(res, index);
		
		return res;
	},
	tabulateAMF0Data: function(data, tabLevel) {
		var tabs = '';
		var j;
		var maxIndex = 0;
		var dataLength = data.length;
		var tempRes;
		var res;
		
		if (dataLength > 2) {		// array is not empty
			for (j = 0; j < tabLevel - 1; j++)
				tabs += '\t';
			if (data[0] == 'strict') {	// Strict Array
				tempRes = 'Array, strict\n' + tabs + '[';
				for (j = 2; j < dataLength; j++) {
					tempRes += '\n' + tabs + '\t' + "'" + maxIndex + "'" + ' => ' +  data[j];
					j++;
					maxIndex++;
				}
				tempRes += '\n' + tabs + ']';
				res = tempRes;
			}
			else {
				j = 0;
				tempRes = '';
				while (j < dataLength - 2) {
					if (data[j] !== undefined) {
						tempRes += '\n' + tabs + '\t' + data[j] + ' => ' + data[j + 1];
						maxIndex++;
					}
					else {
						break;
					}
					j += 2;
				}
				if (data[j] == 'ecma') {
					tempRes = 'Array, ECMA\n' + tabs + '[' + tempRes + '\n' + tabs + ']';
				}
				else if (data[j] == 'object') {
					tempRes = 'Object\n' + tabs + '{' + tempRes + '\n' + tabs + '}';
				}
				else if (data[j] == 'typed object') {
					tempRes = data[j + 1] + '\n' + tabs + '{' + tempRes + '\n' + tabs + '}';
				}
			}
		}
		else {
			if (data[0] === 'strict') {
				tempRes = 'Array, strict ' + '[' + ']';
			} 
			else if (data[0] === 'ecma') {
				tempRes = 'Array, ECMA ' + '[' + ']';
			}
			else if (data[0] === 'object') {
				tempRes = 'Object ' + '{' + '}';
			}
			else if (data[0] === 'typed object') {
				tempRes = data[1] + ' ' + '{' + '}';
			}
		}
		res = tempRes;
		return res;
	},
	// -- AMF3 parsing functions
    tabulateAMF3ObjectData: function(data, tabLevel) {
		var tabs = '';
		var j;
		var nTraits;
		var maxIndex = 0;
		var dataLength = data.length;
		var tempRes;
		var res;
		
			
		for (j = 0; j < tabLevel - 1; j++)
			tabs += '\t';
		if (data[0] == 'anonymous') {
			tempRes = 'Object\n' + tabs + '{';
		}
		else {
			tempRes = data[0] + ' ' + data[1] + '\n' + tabs + '{';
		}
		
		nTraits = data[2];
		if (nTraits != 0) {
			tempRes += '\n' + tabs + 'class members: ';
			for (j = 3; j < nTraits + 3; j++) {
				tempRes += '\n' + tabs + '\t' + data[j] + ' => ' +  data[nTraits + j];
			}
		}
		
		j = nTraits * 2 + 3;
		if (data[1] == 'dynamic' && (j != dataLength - 1)) {
			if (data[0] != 'anonymous') {
				tempRes += '\n' + tabs + 'dynamic members: ';
			}
			while (j < dataLength - 1) {
				tempRes += '\n' + tabs + '\t' + data[j] + ' => ' +  data[j + 1];
				j += 2;
			}
		}
	
		res = tempRes + '\n' + tabs + '}';
		return res;
	},
	
	tabulateAMF3ArrayData: function(data, tabLevel) {
		var tabs = '';
		var j;
		var res;
		var maxIndex = 0;
		var dataLength = data.length;
		
		if (dataLength > 0) {		// array is not empty
			for (j = 0; j < tabLevel - 1; j++)
				tabs += '\t';
			res = 'Array\n' + tabs + '[';
			j = 0;
			while (j < dataLength) {
				if (data[j] !== undefined) {
					res += '\n' + tabs + '\t' + data[j] + ' => ' + data[j + 1];
					maxIndex++;
				}
				else {
					break;
				}
				j += 2;
			}
			j++;
			while (j < dataLength) {
				res += '\n' + tabs + '\t' + "'" + maxIndex + "'" + ' => ' +  data[j];
				j++;
				maxIndex++;
			}
			res += '\n' + tabs + ']';
		}
		else {
			res = '[]';
		}
		
		return res;
	},
	// error check+
	unpackAMF3Data: function(tabLevel) {
        if (this.stringLength <= 0) {
            //console.log("[Amf::amfUnpackData] String is too short");
            return undefined;
        }
        var res = undefined;
		var tempRes;
		if ((this.stringLength - this.currentPos) < 1) {
			return undefined;
		}
		var type = this.getIntegerFromCurrentPos(1);
        
        switch (type) {
            case 0x00:               //AMF3_UNDEFINED_MARKER
                res = '<undefined>';
                break;
            case 0x01:               // AMF3_NULL_MARKER
                res = '<null>';
                break;
            case 0x02:               //  AMF3_FALSE_MARKER
                res = false;
                break;
            case 0x03:               //    AMF3_TRUE_MARKER
                res = true;
                break;
            case 0x04:               //  AMF3_INT_MARKER
                res = this.decodeAMF3Integer();
                if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack3DecodeIntErr");
                    //console.log("[Amf::amfUnpackData] Can't decode integer");
                    return undefined;
                }
                break;
            case 0x05:              //  AMF3_DOUBLE_MARKER
                res = this.decodeDoubleValue();
                if (res === undefined) {
                    //console.log("[Amf::amfUnpackData] Can't decode double");
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack3DecodeDoubleErr");
                    return undefined;
                }
                break;
            case 0x06:              //  AMF3_STRING_MARKER
                res = this.decodeAMF3Str(false);
                if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack3DecodeStrErr");
                    //console.log("[Amf::amfUnpackData] Can't decode string");
                    return undefined;
                }
				break;
			case 0x07:				// AMF3_XML_DOC_MARKER
				res = this.decodeAMF3XML();
                if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack3DecodeXMLErr");
                    //console.log("[Amf::amfUnpackData] Can't decode xml document");
                    return undefined;
                }
				res = 'XML_DOC\n' + res;
                break;
            case 0x08:              //  AMF3_DATE_MARKER
                res = this.decodeAMF3Date();
				if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack3DecodeDateErr");
					//console.log("[Amf::amfUnpackData] Can't decode date");
					return undefined;
				}
				break;    
            case 0x09:              //  AMF3_ARRAY_MARKER
                res = this.decodeAMF3Array(tabLevel);
                if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack3DecodeArrayErr");
					//console.log("[Amf::amfUnpackData] Can't decode array");
					return undefined;
				}
				res = this.tabulateAMF3ArrayData(res, tabLevel);
				break; 
			case 0x0A:
				res = this.decodeAMF3Object(tabLevel);
				if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack3DecodeObjectErr");
					return undefined;	
				}
				res = this.tabulateAMF3ObjectData(res, tabLevel);
				break;
			case 0x0B:				// AMF3_XML_MARKER
				res = this.decodeAMF3XML();
                if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack3DecodeXMLErr");//console.log("[Amf::amfUnpackData] Can't decode xml document");
                    return undefined;
                }
				res = 'XML\n' + res;
				break;
            case 0x0C:       		//  AMF3_BYTE_ARRAY_MARKER
                res = this.decodeAMF3ByteArray(tabLevel);
				if (res === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Unpack3DecodeBArrayErr");
					//console.log("[Amf::amfUnpackData] Can't decode byte array");
					return undefined;
				}
				break;    
            default:
				//this.hasError = true;
				//this.errorPos = this.currentPos;
				this.errorStack.push("Unpack3WrongMarkerTypeErr");
                //console.log("[Amf::amfUnpackData] Unrecognized data type");
                return undefined;
        }
        return res;
    },

	
	// error check+
	decodeAMF3Integer: function() {
		var res = 0;
		var ofs = 0;
        var tmp = 0;
		do {
			if (this.currentPos >= this.stringLength) {
				this.hasError = true;
				this.errorPos = this.currentPos;
				this.errorStack.push("Int3LenOutOfBoundErr");
				//console.log("[Amf::amfDecodeInt] String is too short");
				return undefined;
			}
            tmp = this.getIntegerFromCurrentPos(1);
			if (ofs == 3) {
				res = res << 8;
				res = res | (tmp & 0xFF);
			} else {
				res = res << 7;
				res = res | (tmp & 0x7F);
			}
			ofs++;
		} while ((ofs < 4) && (tmp & 0x80));
		if (res & 0x10000000) {
            res |= ~0x0FFFFFFF; 
        }
		return res;
	},
    
	// error check+
	decodeDoubleValue: function() {
		var res;
		if ((this.stringLength - this.currentPos) < 8) {
			this.hasError = true;
			this.errorPos = this.currentPos;
			this.errorStack.push("DblLenOutOfBoundErr");
			//console.log("[Amf::amfDecodeDouble] String is too short");
			return undefined;
		}
        var targetStr = "";
        for (var i = 7; i >= 0; i--) {
            targetStr += this.StringData.charAt(this.currentPos + i);
        }
		res = this.binaryParser.decodeFloat(targetStr, 52, 11);
        this.currentPos += 8;
        return res;
	},
	
	// error check+
	decodeAMF3Str: function(isKey) {
		var res = '';
		var pfx = 0;
		pfx = this.decodeAMF3Integer();
		if (pfx === undefined) {
			this.hasError = true;
			this.errorPos = this.currentPos;
			this.errorStack.push("Str3PfxUnableToParseIntErr");
			//console.log("[Amf::amfDecodeStr] Can't decode string length");
			return undefined;
		}
		if (pfx == 1) {
			res = '';	// empty string
		}
		else if ((pfx & 1) == 0) {	// reference index
            res = this.getStrByRef(pfx >> 1);
		} else {
			pfx >>= 1;
			if (pfx < 0) {
				this.hasError = true;
				this.errorPos = this.currentPos;
				this.errorStack.push("Str3PfxIsNegAfterShiftErr");
				//console.log("[Amf::amfDecodeStr] Invalid string length");
				return undefined;
			}
			if (pfx > 0) {
				if (this.currentPos + pfx > this.stringLength) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Str3LenOutOfBoundErr");
					//console.log("[Amf::amfDecodeStr] String is too short");
					return undefined;
				}
                var charCode;
                var tmp;
                var k;
                var j = this.currentPos;
                while (j < this.currentPos + pfx) {		// converting from UTF-8 to Unicode
                    charCode = this.binaryParser.decodeInt(this.StringData.charAt(j++), 8, false);
                    if (charCode & 0x80) {			// more than one byte per UTF-8 symbol
                        if ((charCode & 0xE0) == 0xC0) {		// two bytes per UTF-8 symbol
                            charCode &= 0x1F;
                            charCode <<= 6;
                            k = 1;
                        }
                        else if ((charCode & 0xF0) == 0xE0) {	// three bytes per UTF-8 symbol
                            charCode &= 0xF;
                            charCode <<= 12;
                            k = 2;
                        }
                        else if ((charCode & 0xF8) == 0xF0) {	// four byter per UTF-8 symbol
                            charCode &= 0x7;
                            charCode <<= 18;
                            k = 3;
                        }
                        while (k > 0) {
                            tmp = this.binaryParser.decodeInt(this.StringData.charAt(j++), 8, false);
                            tmp &= 0x3F;
                            charCode |= tmp << (--k * 6);
                        }
                    }    
                    res += String.fromCharCode(charCode);
                }
                this.currentPos += pfx;
                this.putStrByRef(res);
			}
		}
		if (isKey == true)
			res = "'" + res + "'";
		else
			res = '\u0022' + res + '\u0022';	// \u0022 = "
		return res;
	},
	
	decodeAMF3XML: function() {
		var res = '';
		var pfx = 0;
		pfx = this.decodeAMF3Integer();
		if (pfx === undefined) {
			//console.log("[Amf::amfDecodeStr] Can't decode string length");
			return undefined;
		}
		if ((pfx & 1) == 0) {	// reference index
            res = this.getObjByRef(pfx >> 1);
		} else {
			pfx >>= 1;
			if (pfx < 0) {
				//console.log("[Amf::amfDecodeStr] Invalid string length");
				return undefined;
			}
			if (pfx > 0) {
				if (this.currentPos + pfx > this.stringLength) {
					//console.log("[Amf::amfDecodeStr] String is too short");
					return undefined;
				}
                var charCode;
                var tmp;
                var k;
                var j = this.currentPos;
                while (j < this.currentPos + pfx) {		// converting from UTF-8 to Unicode
                    charCode = this.binaryParser.decodeInt(this.StringData.charAt(j++), 8, false);
                    if (charCode & 0x80) {			// more than one byte per UTF-8 symbol
                        if ((charCode & 0xE0) == 0xC0) {		// two bytes per UTF-8 symbol
                            charCode &= 0x1F;
                            charCode <<= 6;
                            k = 1;
                        }
                        else if ((charCode & 0xF0) == 0xE0) {	// three bytes per UTF-8 symbol
                            charCode &= 0xF;
                            charCode <<= 12;
                            k = 2;
                        }
                        else if ((charCode & 0xF8) == 0xF0) {	// four byter per UTF-8 symbol
                            charCode &= 0x7;
                            charCode <<= 18;
                            k = 3;
                        }
                        while (k > 0) {
                            tmp = this.binaryParser.decodeInt(this.StringData.charAt(j++), 8, false);
                            tmp &= 0x3F;
                            charCode |= tmp << (--k * 6);
                        }
                    }    
                    res += String.fromCharCode(charCode);
                }
                this.currentPos += pfx;
                this.putObjByRef(res);
			}
		}
		
		return res;
	},
	
	decodeAMF3Date: function() {
        var res;
        var pfx = this.decodeAMF3Integer();
        if (pfx === undefined) {
            //console.log("[Amf::amfDecodeData] Can't decode date prefix");
            return undefined;
        }
        if ((pfx & 1) == 0) { // reference index
            res = this.getObjByRef(pfx >> 1);
        } else {
            var tmp = this.decodeDoubleValue();
            if (tmp === undefined) {
                //console.log("[Amf::amfDecodeData] Can't decode date");
                return undefined;
            }
            res = new Date(tmp);
            this.putObjByRef(res);
        }        
        return res;
    },
	
	// error check+
	decodeAMF3Array: function(tabLevel) {
        var key;
        var value;
		var res = null;
        var objectArray = [];
        var pfx = this.decodeAMF3Integer();
        if (pfx === undefined) {
			this.hasError = true;
			this.errorPos = this.currentPos;
			this.errorStack.push("Arr3PfxUnableToParseIntErr");
            //console.log("[Amf::amfDecodeArray] Can't decode array prefix");
            return undefined;
        }
        if ((pfx & 1) == 0) { // reference index
            res = this.getObjByRef(pfx >> 1);
        } else {
            var arrayIndex = this.putObjByRef(res);   // holding place in ref table
            pfx >>= 1;
            if (pfx < 0) {
				this.hasError = true;
				this.errorPos = this.currentPos;
				this.errorStack.push("Arr3PfxIsNegAfterShiftErr");
                return undefined;
            }
            for ( ;; ) { // associative array portion
                key = this.decodeAMF3Str(true);
                if (key === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Arr3KeyUnableToParseStrErr");
                    //console.log("[Amf::amfDecodeArray] Can't decode array key");
                    return undefined;
                }
                if (key.length <= 2) // '' - null key 
                    break;
                value = this.unpackAMF3Data(tabLevel + 1);
                if (value === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Arr3ValUnableToParseData");
                    //console.log("[Amf::amfDecodeArray] Can't decode array value");
                    return undefined;
                }
                objectArray.push(key);
				objectArray.push(value);
            }
            key = undefined;
			if (pfx > 0)			// if there are any values
				objectArray.push(key);
            while (pfx-- > 0) {
                value = this.unpackAMF3Data(tabLevel + 1);
                if (value === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Arr3StrictUnableToParseData");
                    //console.log("[Amf::amfDecodeArray] Can't decode array value");
                    return undefined;
                }
				objectArray.push(value);
            }

			res = objectArray;
            this.putObjByRef(res, arrayIndex);   // writing info
        }
        return res;
    },
	
	// error check+
	decodeAMF3Object: function (tabLevel) {
		var res = [];
		var traitsArray  = [];
		var bitmask;
		var nTraits;
		var traitIndex;
		var className;
		var i;
		var index;
		var property;
		var value;
		var pfx = this.decodeAMF3Integer();
		if (pfx === undefined) {
			this.hasError = true;
			this.errorPos = this.currentPos;
			this.errorStack.push("Obj3PfxUnableToParseIntErr");
            return undefined;
        }
		
        if ((pfx & 0x1) == 0) { // first bit is 0
			res = this.getObjByRef(pfx >> 1);	// Object is referenced
		}
		else if (((pfx & 0x1) == 1) && ((pfx & 0x2) == 0)) {		// first = 1 second = 0	 
			traitsArray = this.getTraitByRef(pfx >> 2);			// get traits
			index = this.putObjByRef(res);
			res.push(traitsArray[0]);
			res.push(traitsArray[1]);
			nTraits = traitsArray.length - 2;
			this.errorStack.push(traitsArray);
			this.errorStack.push(this.maxTraitIndex);
			res.push(nTraits);
			for (i = 0; i < nTraits; i++) {
				res.push(traitsArray[i + 2]);
			}
			for (i = 0; i < nTraits; i++) {
				value = this.unpackAMF3Data(tabLevel + 1);
				if (value == undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Obj3TraitsUnableToParseDataErr");
					return undefined;
				}
				res.push(value);
			}
			if (res[1] == 'dynamic') {
				for (;;) {
					property = this.decodeAMF3Str(true);
					if (property == undefined) {
						this.hasError = true;
						this.errorPos = this.currentPos;
						this.errorStack.push("Obj3DynamicUnableToParseDynamicPropStrErr");						
						return undefined;
					}
					if (property.length <= 2) { // null ""
						this.putObjByRef(res, index);
						return res;
					}
					value = this.unpackAMF3Data(tabLevel + 1);
					if (value == undefined) {
						this.hasError = true;
						this.errorPos = this.currentPos;
						this.errorStack.push("Obj3DynamicUnableToParseDynamicDataErr");					
						return undefined;
					}
					res.push(property);
					res.push(value);
				}
			}
			else {
				this.putObjByRef(res, index);
			}
		}
		else if ((pfx & 0x3) == 0x3) {	// all the data is inlined
			bitmask = pfx & 0xC;
			if (bitmask == 0) {	// non dynamic
				traitIndex = this.putTraitByRef(traitsArray);
				index = this.putObjByRef(res);
				nTraits = pfx >> 4;
				className = this.decodeAMF3Str(false);
				if (className === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Obj3StaticUnableToParseClassNameErr");
					return undefined;
				}
				if (className.length <= 2) // "" - null string 
                    res.push('anonymous');
				else
					res.push(className);
				res.push('non-dynamic');
				res.push(nTraits);
				traitsArray.push(res[0]);
				traitsArray.push(res[1]);
				if (nTraits != 0) {
					for (i = 0; i < nTraits; i++) {
						property = this.decodeAMF3Str(true);
						if (property == undefined) {
							this.hasError = true;
							this.errorPos = this.currentPos;
							this.errorStack.push("Obj3StaticUnableToParsePropStrErr");
							return undefined;
						}
						traitsArray.push(property);
						res.push(property);
					}
					for (i = 0; i < nTraits; i++) {
						value = this.unpackAMF3Data(tabLevel + 1);
						if (value == undefined) {
							this.hasError = true;
							this.errorPos = this.currentPos;
							this.errorStack.push("Obj3StaticUnableToParseDataErr");
							return undefined;
						}
						res.push(value);
					}	
				}
				this.putTraitByRef(traitsArray, traitIndex);
				this.putObjByRef(res, index);
			}
			else if (bitmask == 0x8) {	// dynamic
				traitIndex = this.putTraitByRef(traitsArray);
				index = this.putObjByRef(res);
				nTraits = pfx >> 4;
				className = this.decodeAMF3Str(false);
				if (className === undefined) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("Obj3DynamicUnableToParseClassNameErr");
					return undefined;
				}
				if (className.length <= 2) // "" - null string 
                    res.push('anonymous');
				else
					res.push(className);
				res.push('dynamic');
				res.push(nTraits);
				traitsArray.push(res[0]);
				traitsArray.push(res[1]);
				if (nTraits != 0) {
					for (i = 0; i < nTraits; i++) {
						property = this.decodeAMF3Str(true);
						if (property == undefined) {
							this.hasError = true;
							this.errorPos = this.currentPos;
							this.errorStack.push("Obj3DynamicUnableToParseStaticPropStrErr");
							return undefined;
						}
						traitsArray.push(property);
						res.push(property);
					}
					this.putTraitByRef(traitsArray, traitIndex);
					for (i = 0; i < nTraits; i++) {
						value = this.unpackAMF3Data(tabLevel + 1);
						if (value == undefined) {
							this.hasError = true;
							this.errorPos = this.currentPos;
							this.errorStack.push("Obj3DynamicUnableToParseStaticDataErr");
							return undefined;
						}
						res.push(value);
					}	
				}
				for (;;) {
					property = this.decodeAMF3Str(true);
					if (property == undefined) {
						this.hasError = true;
						this.errorPos = this.currentPos;
						this.errorStack.push("Obj3DynamicUnableToParseDynamicPropStrErr");						
						return undefined;
					}
					if (property.length <= 2) { // null ""
						//res.push(undefined);			// under testing
						this.putTraitByRef(traitsArray, traitIndex);
						this.putObjByRef(res, index);
						return res;
					}
					value = this.unpackAMF3Data(tabLevel + 1);
					if (value == undefined) {
						this.hasError = true;
						this.errorPos = this.currentPos;
						this.errorStack.push("Obj3DynamicUnableToParseDynamicDataErr");					
						return undefined;
					}
					res.push(property);
					res.push(value);
				}
			}
			else if (bitmask == 0x4) {	// externalizible
				this.hasError = true;
				this.errorPos = this.currentPos;
				this.errorStack.push("Obj3PfxIsExternalizibleErr");	
				return undefined;		// resolving depends on algorithm
			}
			else if (bitmask == 0xC) {	// can't be
				this.hasError = true;
				this.errorPos = this.currentPos;
				this.errorStack.push("Obj3PfxWrongPrefixErr");	
				return undefined;
			}
		}
        
		return res;		
	},
    
	// error check+
	decodeAMF3ByteArray: function (tabLevel) {
		var res = 'ByteArray [';
		var pfx = 0;
		pfx = this.decodeAMF3Integer();
		if (pfx === undefined) {
			this.hasError = true;
			this.errorPos = this.currentPos;
			this.errorStack.push("BArr3PfxUnableToParseIntErr");
			//console.log("[Amf::amfDecodeByteArray] Can't decode prefix");
			return undefined;
		}
		if ((pfx & 1) == 0) {	// reference index
            res = this.getObjByRef(pfx >> 1);
		} else {
			pfx >>= 1;
			if (pfx < 0) {
				this.hasError = true;
				this.errorPos = this.currentPos;
				this.errorStack.push("BArr3PfxIsNegAfterShiftErr");
				//console.log("[Amf::amfDecodeByteArray] Invalid byte array length");
				return undefined;
			}
			if (pfx > 0) {
				if (this.currentPos + pfx > this.stringLength) {
					this.hasError = true;
					this.errorPos = this.currentPos;
					this.errorStack.push("BArr3LenOutOfBoundErr");
					//console.log("[Amf::amfDecodeByteArray] String is too short");
					return undefined;
				}
				var oldPos = this.currentPos;
				var tmp = this.unpackAMF3Data(tabLevel + 1);
				if (tmp === undefined) {
					this.currentPos = oldPos;
					for (var i = 0; i < pfx; i++) {
						//res = this.StringData.charAt(this.currentPos);
						//this.currentPos++;
						tmp = this.getIntegerFromCurrentPos(1);
						res += tmp.toString(16) + " ";
					}
				}
				else {
					res += tmp;
				}
				res += ']';
				this.putObjByRef(res); // empty array also is stored
			}
			else if (pfx == 0) {
				res = 'empty]';
				//this.putObjByRef(res);
			}
		}
		return res;        
    },
	


	// -- Reference tables functions
    //+
	getAMF0ReferencedObject: function() {
		var index;
		
		if ((this.stringLength - this.currentPos) < 2) {
			return undefined;
		}
		index = this.getIntegerFromCurrentPos(2);
		return this.getAMF0ObjByRef(index);
	},
	
	getAMF0ObjByRef: function(ref) {
        if ((this.maxAMF0ObjIndex === undefined) || ref > this.maxAMF0ObjIndex)
        {
            //console.log("[Amf::amfGetObjByRefString] Index out of range");
            return undefined;
        }
		return this.AMF0ObjectRefTable[ref];
	},
	
	//+
    putAMF0ObjByRef: function(obj, index) {
        if (index === undefined) {
            if (this.maxAMF0ObjIndex === undefined)
                this.maxAMF0ObjIndex = 0;
            else
                this.maxAMF0ObjIndex++;
            this.AMF0ObjectRefTable.push(obj);
            return this.maxAMF0ObjIndex;
        }
        else
            this.AMF0ObjectRefTable[index] = obj;
        return -1;
	},
	
	
    //+
	getStrByRef: function(ref) {
        if ((this.maxStrIndex === undefined) || ref > this.maxStrIndex)
        {
            //console.log("[Amf::amfGetStrByRefString] Index out of range");
            return undefined;
        }
		return this.StringRefTable[ref];
	},
	
	putStrByRef: function(str) {
        if (this.maxStrIndex === undefined)
            this.maxStrIndex = 0;
        else
            this.maxStrIndex++;
		this.StringRefTable.push(str); // pushing in the end of array
	},
    getObjByRef: function(ref) {
        if ((this.maxObjIndex === undefined) || ref > this.maxObjIndex)
        {
			//console.log("[Amf::amfGetObjByRefString] Index out of range");
            return undefined;
        }
		return this.ObjectRefTable[ref];
	},
	
	//+
    putObjByRef: function(obj, index) {
        if (index === undefined) {
            if (this.maxObjIndex === undefined)
                this.maxObjIndex = 0;
            else
                this.maxObjIndex++;
            this.ObjectRefTable.push(obj);
            return this.maxObjIndex;
        }
        else
            this.ObjectRefTable[index] = obj;
        return -1;
	},
	
	getTraitByRef: function(ref) {
        if ((this.maxTraitIndex === undefined) || ref > this.maxTraitIndex)
        {
            //console.log("[Amf::amfGetObjByRefString] Index out of range");
            return undefined;
        }
		return this.TraitRefTable[ref];
	},
	
	//+
    putTraitByRef: function(trait, index) {
        if (index === undefined) {
            if (this.maxTraitIndex === undefined)
                this.maxTraitIndex = 0;
            else
                this.maxTraitIndex++;
            this.TraitRefTable.push(trait);
            return this.maxTraitIndex;
        }
        else
            this.TraitRefTable[index] = trait;
        return -1;
	}
}